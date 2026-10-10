import Foundation

/// Thin client for /api/v1/* on the Finny dashboard. Retries once with a fresh token on 401.
@MainActor
struct API {
    let auth: Auth

    func overview(_ period: Period) async throws -> Overview {
        try await get("overview", ["period": period.rawValue])
    }

    func transactions(query: String? = nil, currency: String? = nil, card: String? = nil,
                      category: String? = nil, from: String? = nil, to: String? = nil,
                      offset: Int = 0, limit: Int = 50) async throws -> TxnPage {
        try await get("transactions", [
            "q": query, "currency": currency, "card": card, "category": category, "from": from, "to": to,
            "offset": String(offset), "limit": String(limit),
        ])
    }

    func transaction(id: String) async throws -> Txn {
        try await get("transactions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)", [:])
    }

    func breakdown(groupBy: String, period: String? = nil, from: String? = nil, currency: String? = nil) async throws -> [String: Breakdown] {
        try await get("breakdown", ["group_by": groupBy, "period": period, "from": from, "currency": currency])
    }

    func splits() async throws -> Splits { try await get("splits", [:]) }
    func subscriptions() async throws -> [Subscription] { try await get("subscriptions", [:]) }
    func meta() async throws -> Meta { try await get("meta", [:]) }

    private func get<T: Decodable>(_ path: String, _ params: [String: String?]) async throws -> T {
        guard let base = auth.serverURL else { throw AuthError.signedOut }
        var comps = URLComponents(url: base.appending(path: "api/v1/" + path), resolvingAgainstBaseURL: false)!
        let items = params.compactMap { k, v in v.flatMap { $0.isEmpty ? nil : URLQueryItem(name: k, value: $0) } }
        if !items.isEmpty { comps.queryItems = items }

        for attempt in 0..<2 {
            var req = URLRequest(url: comps.url!)
            req.setValue("Bearer \(try await auth.validAccessToken(forceRefresh: attempt > 0))", forHTTPHeaderField: "Authorization")
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && attempt == 0 { continue }
            guard (200..<300).contains(status) else {
                let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                throw AuthError.message(msg ?? "Request failed (\(status)).")
            }
            return try JSONDecoder().decode(T.self, from: data)
        }
        throw AuthError.signedOut
    }
}
