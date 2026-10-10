import Foundation

/// Thin client for /api/v1/* on the Finny dashboard. Retries once with a fresh token on 401.
@MainActor
struct API {
    let auth: Auth

    func overview(_ period: Period, combine: String? = nil) async throws -> Overview {
        try await get("overview", ["period": period.rawValue, "combine": combine])
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
        try await get("transactions/\(API.encodeID(id))", [:])
    }

    func breakdown(groupBy: String, period: String? = nil, from: String? = nil, currency: String? = nil,
                   combine: String? = nil) async throws -> [String: Breakdown] {
        try await get("breakdown", ["group_by": groupBy, "period": period, "from": from, "currency": currency, "combine": combine])
    }

    /// Transaction ids are email message ids (may contain / < > @), so encode everything but unreserved chars.
    static func encodeID(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? id
    }

    // MARK: Edits

    struct Ignored: Decodable {}

    /// Tag and/or recategorise a transaction; `applyToMerchant` covers its merchant's past and future transactions.
    func edit(transaction id: String, tag: String?? = nil, category: String? = nil, applyToMerchant: Bool) async throws {
        var body: [String: Any] = ["apply_to_merchant": applyToMerchant]
        if let tag { body["tag"] = tag ?? NSNull() }
        if let category { body["category"] = category }
        let _: Ignored = try await send("PATCH", "transactions/\(API.encodeID(id))", body)
    }

    /// Replace who owes what on a transaction. Empty list removes the split.
    func setSplits(transaction id: String, _ splits: [(name: String, amount: Double)]) async throws {
        let _: Ignored = try await send("PUT", "transactions/\(API.encodeID(id))/splits",
                                        ["splits": splits.map { ["name": $0.name, "amount": $0.amount] }])
    }

    func people() async throws -> [Person] { (try await get("people", [:]) as PeoplePage).people }

    func settle(personID: Int, currency: String) async throws {
        let _: Ignored = try await send("POST", "splits/settle", ["person_id": personID, "currency": currency])
    }

    func incoming(period: Period) async throws -> [Incoming] {
        (try await get("incoming", ["period": period.rawValue]) as IncomingPage).incoming
    }

    func setIncomingKind(id: String, kind: String, applyToSender: Bool) async throws {
        let _: Ignored = try await send("PATCH", "incoming/\(API.encodeID(id))", ["kind": kind, "apply_to_counterparty": applyToSender])
    }

    /// Custom display name for a merchant (all past and future transactions). nil resets it.
    func rename(merchant raw: String, to name: String?) async throws {
        let _: Ignored = try await send("POST", "merchants/rename", ["merchant": raw, "display_name": name ?? NSNull()])
    }

    func splits() async throws -> Splits { try await get("splits", [:]) }
    func subscriptions() async throws -> [Subscription] { try await get("subscriptions", [:]) }
    func meta() async throws -> Meta { try await get("meta", [:]) }

    private func send<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any]) async throws -> T {
        guard let base = auth.serverURL else { throw AuthError.signedOut }
        for attempt in 0..<2 {
            var req = URLRequest(url: base.appending(path: "api/v1/" + path))
            req.httpMethod = method
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(try await auth.validAccessToken(forceRefresh: attempt > 0))", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && attempt == 0 { continue }
            if status == 403 {
                throw AuthError.message("Editing needs a fresh sign-in. Go to Settings → Sign out, then sign in again.")
            }
            guard (200..<300).contains(status) else {
                let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                throw AuthError.message(msg ?? "Couldn't save (\(status)).")
            }
            return try JSONDecoder().decode(T.self, from: data)
        }
        throw AuthError.signedOut
    }

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
