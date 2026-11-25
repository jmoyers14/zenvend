import HTTPTypes
import OpenAPIRuntime
import SwiftData
import XCTest

@testable import Zenvend

/// A server value this build has never seen, through the real generated
/// decoder. Before the spec opened its response enums, one new machine kind
/// failed the whole refresh and the phone went stale behind "couldn't reach
/// the server".
@MainActor
final class UnknownEnumRefreshTests: XCTestCase {
    private var context: ModelContext!

    override func setUp() async throws {
        let container = try ZenvendStore.makeInMemoryContainer()
        context = ModelContext(container)
    }

    func testAnUnknownMachineKindLandsWithTheRestOfTheRefresh() async throws {
        try await refreshAndAssertSynced()

        let machines = try context.fetch(FetchDescriptor<StoredMachine>())
        let byId = Dictionary(uniqueKeysWithValues: machines.map { ($0.id, $0) })
        XCTAssertEqual(byId["machine-known"]?.machineKind, .snack)
        let newMachine = try XCTUnwrap(byId["machine-new"])
        XCTAssertEqual(newMachine.kind, "frozen")
        XCTAssertNil(newMachine.machineKind)
        XCTAssertEqual(newMachine.cardReader?.provider, "square")
    }

    func testAnUnknownCommissionArmLandsWithTheRestOfTheRefresh() async throws {
        try await refreshAndAssertSynced()

        let locations = try context.fetch(FetchDescriptor<StoredLocation>())
        let byId = Dictionary(uniqueKeysWithValues: locations.map { ($0.id, $0) })
        let known = try XCTUnwrap(byId["location-known"]?.commission)
        XCTAssertEqual(known.kind, .percent)
        XCTAssertEqual(known.percentBps, 1000)
        let tiered = try XCTUnwrap(byId["location-new"]?.commission)
        XCTAssertEqual(tiered.type, "tiered")
        XCTAssertNil(tiered.kind)
    }

    func testAnUnknownRemovedReasonStillLandsTheLatestVisit() async throws {
        try await refreshAndAssertSynced()

        XCTAssertEqual(try context.fetchCount(FetchDescriptor<StoredLatestVisit>()), 1)
    }

    func testAnUnknownUpdateVerdictWallsNothing() async throws {
        let verdict = try await makeClient().fetchClientSupport(build: 1)

        XCTAssertEqual(verdict.updateRequirement, .none)
    }

    private func refreshAndAssertSynced() async throws {
        let refresher = MirrorRefresher(api: makeClient(), writer: MirrorWriter(context: context))
        await refresher.refresh()
        guard case .synced = refresher.state else {
            XCTFail("expected .synced, got \(refresher.state)")
            throw CancellationError()
        }
    }

    // MARK: - Stubbed server

    private func makeClient() -> ZenvendAPIClient {
        ZenvendAPIClient(
            transport: StubTransport { request, _ in
                let path = request.path?.split(separator: "?").first.map(String.init) ?? ""
                guard let json = Self.responses.first(where: { path.hasSuffix($0.key) })?.value else {
                    return (HTTPResponse(status: .notFound), nil)
                }
                return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(json))
            },
            middlewares: []
        )
    }

    private nonisolated static let stamp = "\"createdAt\":\"2026-11-25T08:00:00Z\",\"updatedAt\":\"2026-11-25T08:00:00Z\""

    private nonisolated static let responses: [String: String] = [
        "/client-support": """
        {"updateRequirement":"blocked","updateUrl":"https://example.com/app"}
        """,
        "/me": """
        {"userId":"user-1","orgId":"org-a","orgRole":"org:admin","orgSlug":null}
        """,
        "/locations": """
        [\(location(id: "location-known", commission: #"{"type":"percent","percentBps":1000,"basis":"gross"}"#)),\
        \(location(id: "location-new", commission: #"{"type":"tiered","tiers":[{"fromCents":0,"percentBps":500}]}"#))]
        """,
        "/machines": """
        [\(machine(id: "machine-known", kind: "snack", provider: "nayax")),\
        \(machine(id: "machine-new", kind: "frozen", provider: "square"))]
        """,
        "/products": """
        [{"id":"product-1","name":"Doritos","upc":null,"category":"snacks","taxClass":null,"imageUrl":null,\
        "defaultPriceCents":150,"active":true,"tracksExpiration":false,\(stamp)}]
        """,
        "/packs": "[]",
        "/planograms/current": "[]",
        "/visits/latest": """
        [{"id":"visit-1","machineId":"machine-known","locationId":"location-known","planogramId":null,\
        "countedAt":"2026-11-25T08:00:00Z","recordedByUserId":"user-1","notes":null,"clientRequestId":"request-1",\
        "lines":[{"slotCode":"A0","productId":"product-1","remaining":2,"added":6,"removed":1,\
        "removedReason":"stolen","priceCents":150,"par":null,"bestBy":null}],\(stamp)}]
        """,
    ]

    private nonisolated static func location(id: String, commission: String) -> String {
        """
        {"id":"\(id)","name":"\(id)","address":{"line1":null,"city":null,"state":null,"zip":null,"geo":null},\
        "contact":{"name":null,"phone":null,"email":null},"commission":\(commission),"notes":null,"active":true,\(stamp)}
        """
    }

    private nonisolated static func machine(id: String, kind: String, provider: String) -> String {
        """
        {"id":"\(id)","locationId":"location-known","name":"\(id)","kind":"\(kind)","make":null,"model":null,\
        "serial":null,"tagCode":null,"templateId":null,"slots":[["A0"]],\
        "cardReader":{"provider":"\(provider)","deviceId":"device-1"},"active":true,\(stamp)}
        """
    }
}
