import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Stamps `X-Zenvend-Client: ios/<build>` on every request and, on a `426`,
/// hands the server's verdict to the gate.
///
/// The response still goes back up unchanged, so the caller classifies the
/// failure as it already does — the outbox keeps the row as retryable.
struct ClientSupportMiddleware: ClientMiddleware {
    /// `nil` sends no header, which the server passes through rather than guess.
    let build: Int?
    let gate: ClientSupport

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable @concurrent (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let build {
            request.headerFields[.zenvendClient] = "ios/\(build)"
        }

        let (response, responseBody) = try await next(request, body, baseURL)
        guard response.status == .upgradeRequired else {
            return (response, responseBody)
        }

        // The spec types this body as the generic error, which has no
        // `updateUrl`, so it is read here rather than through the generated client.
        guard let responseBody else {
            await gate.requireUpdate(updateUrl: nil)
            return (response, nil)
        }
        let data = try await Data(collecting: responseBody, upTo: 64 * 1024)
        await gate.requireUpdate(updateUrl: Self.updateUrl(in: data))
        return (response, HTTPBody(data))
    }

    private static func updateUrl(in data: Data) -> URL? {
        struct Rejection: Decodable { let updateUrl: String? }
        let rejection = try? JSONDecoder().decode(Rejection.self, from: data)
        return rejection?.updateUrl.flatMap(URL.init(string:))
    }
}

extension HTTPField.Name {
    static let zenvendClient = Self("X-Zenvend-Client")!
}
