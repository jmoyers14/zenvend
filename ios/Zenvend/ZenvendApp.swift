import ClerkKit
import SwiftData
import SwiftUI

@main
struct ZenvendApp: App {
    @State private var session = ClerkSession()
    @State private var clientSupport: ClientSupport
    @State private var lock = LocalLock()
    @State private var refresher: MirrorRefresher
    @State private var submitter: OutboxSubmitter
    private let container: ModelContainer
    /// Handed to feature screens through `\.zenvendAPI` — `PurchaseLogView`
    /// is the first to need the raw client rather than a service built on it.
    private let api: any ZenvendAPI

    @Environment(\.scenePhase) private var scenePhase

    init() {
        Clerk.configure(publishableKey: AppEnvironment.clerkPublishableKey)
        let container = ZenvendStore.makeContainer()
        self.container = container
        let clientSupport = ClientSupport()
        _clientSupport = State(initialValue: clientSupport)
        // One client for both pipes: same base URL, same middleware. The
        // client-support stamp is what lets the server 426 an old build.
        let api = ZenvendAPIClient(middlewares: [
            AuthTokenMiddleware(),
            ClientSupportMiddleware(build: ClientBuild.current, gate: clientSupport),
        ])
        self.api = api
        _refresher = State(
            initialValue: MirrorRefresher(
                api: api,
                writer: MirrorWriter(context: container.mainContext)
            )
        )
        _submitter = State(
            initialValue: OutboxSubmitter(
                api: api,
                context: container.mainContext,
                isUpdateRequired: { clientSupport.isUpdateRequired }
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView(lock: lock, clientSupport: clientSupport)
            .environment(session)
            .environment(clientSupport)
            .environment(refresher)
            .environment(submitter)
            .environment(\.zenvendAPI, api)
            .modelContainer(container)
            .task {
                #if DEBUG
                clientSupport.applyLaunchArgumentOverride()
                #endif
                // Clerk rehydrates a persisted session itself; this only reads
                // the result. It must never gate what is shown — a cold offline
                // launch is expected to fail here.
                session.refreshFromClerk()
                await refreshAndDrain()
            }
            // Backoff needs a retry lifecycle events will not provide: submit
            // in a basement, walk upstairs, never background the app.
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    await submitter.drain()
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await refreshAndDrain() }
            }
            // Signing in happens in-app, so neither trigger above fires for it.
            // Without this a fresh install dead-ends: the launch refresh 401s
            // with no session, and FirstRunView has nothing to pull on.
            .onChange(of: session.isSignedIn) { _, signedIn in
                guard signedIn else { return }
                Task {
                    await refresher.refresh()
                    // A draft queued before sign-in drains as soon as there is
                    // a token.
                    await submitter.drain()
                }
            }
        }
    }

    /// The verdict lands before the drain, so a too-old build never submits
    /// first and learns afterwards. The mirror refresh runs alongside it.
    private func refreshAndDrain() async {
        async let verdictChecked: Void = checkClientSupport()
        await refresher.refresh()
        await verdictChecked
        await submitter.drain()
    }

    /// Best-effort: offline keeps the current verdict, and the `426` backstop
    /// covers whatever this misses.
    private func checkClientSupport() async {
        #if DEBUG
        // A forced wall would otherwise be cleared by the real verdict.
        guard !ProcessInfo.processInfo.arguments.contains("-updateRequirement") else { return }
        #endif
        guard let build = ClientBuild.current else { return }
        do {
            let verdict = try await api.fetchClientSupport(build: build)
            clientSupport.apply(verdict.updateRequirement, updateUrl: verdict.updateUrl)
        } catch {
            print("[client-support] check failed: \(error)")
        }
    }
}
