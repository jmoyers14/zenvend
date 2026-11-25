import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import Zenvend

/// The real client and middleware against canned HTTP, so the header the
/// server gates on and the `426` that flips the gate both run end to end.
@MainActor
final class ClientSupportMiddlewareTests: XCTestCase {
    private func makeClient(
        build: Int? = 42,
        support: ClientSupport,
        respond: @escaping @Sendable (HTTPRequest) -> (Int, String)
    ) -> ZenvendAPIClient {
        ZenvendAPIClient(
            transport: StubTransport { request, _ in
                let (status, json) = respond(request)
                return (HTTPResponse(status: .init(code: status)), HTTPBody(json))
            },
            middlewares: [ClientSupportMiddleware(build: build, gate: support)]
        )
    }

    private func visitRequest() throws -> OutboxRequest {
        let submission = VisitSubmission(
            machineId: "6ac1c6c40bfb1cd4c63d3019", locationId: "6ac1c6c40bfb1cd4c63d3020",
            planogramId: nil, countedAt: Date(timeIntervalSince1970: 1_800_000_000),
            lines: [], notes: nil, clientRequestId: "visit-req-0001"
        )
        return OutboxRequest(kind: "visit", clientRequestId: submission.clientRequestId,
                             payload: try VisitSubmission.makeEncoder().encode(submission))
    }

    func testA426FlipsTheGateToRequired() async throws {
        let support = ClientSupport()
        let client = makeClient(support: support) { _ in (426, UpgradeRequiredStub.body) }

        let outcome = await client.submit(try visitRequest())

        XCTAssertEqual(support.requirement, .required)
        XCTAssertTrue(support.isWallVisible)
        XCTAssertEqual(support.updateUrl, UpgradeRequiredStub.updateUrl)
        XCTAssertEqual(outcome, .blockedByUpdateFloor, "the row stays queued, never needsAttention")
    }

    /// The middleware buffers the body to read `updateUrl`; the read path
    /// still has to see a 426, not a decode failure.
    func testA426OnAReadStillReachesTheCallerAsA426() async {
        let support = ClientSupport()
        let client = makeClient(support: support) { _ in (426, UpgradeRequiredStub.body) }

        do {
            _ = try await client.fetchBarcodeCandidate(code: "012345678905")
            XCTFail("a 426 must not read as a result")
        } catch let error as ZenvendAPIError {
            XCTAssertEqual(error.statusCode, 426)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        XCTAssertEqual(support.requirement, .required)
    }

    func testA426WithoutAReadableBodyStillWalls() async throws {
        let support = ClientSupport()
        let client = makeClient(support: support) { _ in (426, "not json") }

        _ = await client.submit(try visitRequest())

        XCTAssertEqual(support.requirement, .required)
    }

    func testOtherFailuresLeaveTheGateAlone() async throws {
        let support = ClientSupport()
        let client = makeClient(support: support) { _ in (401, #"{"message":"no"}"#) }

        _ = await client.submit(try visitRequest())

        XCTAssertEqual(support.requirement, .none)
    }

    func testEveryRequestIsStampedWithTheBuildNumber() async {
        let support = ClientSupport()
        let stamped = LockedBox<String?>(nil)
        let client = makeClient(support: support) { request in
            stamped.value = request.headerFields[.zenvendClient]
            return (200, "[]")
        }

        _ = try? await client.fetchLocations()

        XCTAssertEqual(stamped.value, "ios/42", "the server parses exactly ios/<digits>")
    }

    /// The server passes an unstamped request through, which beats guessing a
    /// number that walls everyone or no one.
    func testAnUnreadableBuildSendsNoStamp() async {
        let support = ClientSupport()
        let stamped = LockedBox<String?>("unset")
        let client = makeClient(build: nil, support: support) { request in
            stamped.value = request.headerFields[.zenvendClient]
            return (200, "[]")
        }

        _ = try? await client.fetchLocations()

        XCTAssertNil(stamped.value)
    }

    func testTheLaunchCheckDecodesTheVerdict() async throws {
        let support = ClientSupport()
        let client = makeClient(support: support) { _ in
            (200, #"{"updateRequirement":"recommended","updateUrl":"\#(UpgradeRequiredStub.updateUrl)"}"#)
        }

        let verdict = try await client.fetchClientSupport(build: 42)

        XCTAssertEqual(verdict.updateRequirement, .recommended)
        XCTAssertEqual(verdict.updateUrl, UpgradeRequiredStub.updateUrl)
    }
}
