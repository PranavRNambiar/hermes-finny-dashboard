import Foundation

/// Minimal read-only client for widgets: trades the shared refresh token for an
/// access token, then reads /api/v1. (The app itself uses Auth + API.)
struct FinnyClient {
    enum Failure: Error { case signedOut, http(Int) }

    struct Summary: Decodable {
        struct Total: Decodable { let total: Double; let count: Int }
        let today: String
        let totals: [String: [String: Total]]   // range → currency → total
    }

    private struct Token: Decodable { let access_token: String }

    static func summary(combine: String?) async throws -> Summary {
        try await get("summary", combine.map { ["combine": $0] } ?? [:])
    }

    static func insight(_ spec: InsightSpec, combine: String?) async throws -> InsightData {
        let (path, q) = spec.request(combine: combine)
        return path == "compare" ? InsightData(compare: try await get(path, q)) : InsightData(breakdown: try await get(path, q))
    }

    private static func get<T: Decodable>(_ path: String, _ params: [String: String]) async throws -> T {
        try await get(path, params.map { URLQueryItem(name: $0.key, value: $0.value) })
    }

    private static func get<T: Decodable>(_ path: String, _ items: [URLQueryItem]) async throws -> T {
        guard let base = SharedStore.serverURL, let refresh = TokenStore.read() else { throw Failure.signedOut }
        var tokenReq = URLRequest(url: base.appending(path: "oauth/token"))
        tokenReq.httpMethod = "POST"
        tokenReq.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        tokenReq.httpBody = "grant_type=refresh_token&client_id=finny-ios&refresh_token=\(refresh)".data(using: .utf8)
        let (td, tr) = try await URLSession.shared.data(for: tokenReq)
        guard (tr as? HTTPURLResponse)?.statusCode == 200 else { throw Failure.signedOut }
        let access = try JSONDecoder().decode(Token.self, from: td).access_token

        var comps = URLComponents(url: base.appending(path: "api/v1/" + path), resolvingAgainstBaseURL: false)!
        if !items.isEmpty { comps.queryItems = items }
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure.http(status) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
