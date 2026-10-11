import CryptoKit
import Foundation

/// Last good response for every GET, in memory and on disk. Screens paint from it instantly,
/// then refresh in the background (stale-while-revalidate).
@MainActor
enum ResponseCache {
    private static var memory: [String: Data] = [:]
    private static let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "api", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private static func file(_ key: String) -> URL {
        dir.appending(path: SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined())
    }

    static func get(_ key: String) -> Data? {
        if let d = memory[key] { return d }
        guard let d = try? Data(contentsOf: file(key)) else { return nil }
        memory[key] = d
        return d
    }

    static func put(_ key: String, _ data: Data) {
        memory[key] = data
        let url = file(key)
        Task.detached(priority: .utility) { try? data.write(to: url, options: .atomic) }
    }

    static func clear() {
        memory = [:]
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}

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
        try await get("transactions", Self.txnParams(query, currency, card, category, from, to, offset, limit))
    }

    private static func txnParams(_ query: String?, _ currency: String?, _ card: String?, _ category: String?,
                                  _ from: String?, _ to: String?, _ offset: Int, _ limit: Int) -> [String: String?] {
        ["q": query, "currency": currency, "card": card, "category": category, "from": from, "to": to,
         "offset": String(offset), "limit": String(limit)]
    }

    // MARK: Cached reads (instant, possibly stale; nil if never fetched)

    func cachedOverview(_ period: Period, combine: String? = nil) -> Overview? {
        peek("overview", Self.items(["period": period.rawValue, "combine": combine]))
    }
    func cachedTransactions(query: String?, currency: String?, card: String?, category: String?, from: String?, to: String?) -> TxnPage? {
        peek("transactions", Self.items(Self.txnParams(query, currency, card, category, from, to, 0, 50)))
    }
    func cachedBreakdown(groupBy: String, period: String? = nil, from: String? = nil, currency: String? = nil, combine: String? = nil) -> [String: Breakdown]? {
        peek("breakdown", Self.items(["group_by": groupBy, "period": period, "from": from, "currency": currency, "combine": combine]))
    }
    func cachedInsight(_ spec: InsightSpec, combine: String?) -> InsightData? {
        let (path, q) = spec.request(combine: combine)
        return path == "compare" ? (peek(path, q) as Compare?).map { InsightData(compare: $0) } : (peek(path, q) as [String: Breakdown]?).map { InsightData(breakdown: $0) }
    }
    func cachedSubscriptions() -> [Subscription]? { peek("subscriptions", []) }
    func cachedSplits() -> Splits? { peek("splits", []) }
    func cachedSettlements() -> [Settlement]? { (peek("splits/history", []) as SettlementPage?)?.settlements }
    func cachedIncoming(period: Period) -> [Incoming]? { (peek("incoming", Self.items(["period": period.rawValue])) as IncomingPage?)?.incoming }
    func cachedMeta() -> Meta? { peek("meta", []) }

    func insight(_ spec: InsightSpec, combine: String?) async throws -> InsightData {
        let (path, q) = spec.request(combine: combine)
        return path == "compare" ? InsightData(compare: try await get(path, q)) : InsightData(breakdown: try await get(path, q))
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

    func settlements() async throws -> [Settlement] { (try await get("splits/history", [:]) as SettlementPage).settlements }

    func unsettle(personID: Int, settledAt: String) async throws {
        let _: Ignored = try await send("POST", "splits/unsettle", ["person_id": personID, "settled_at": settledAt])
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

    func merchants() async throws -> [MerchantInfo] { (try await get("merchants", [:]) as MerchantPage).merchants }

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

    /// Sorted so the same request always maps to the same cache entry.
    private static func items(_ params: [String: String?]) -> [URLQueryItem] {
        params.compactMap { k, v in v.flatMap { $0.isEmpty ? nil : URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
    }

    private func url(_ path: String, _ items: [URLQueryItem]) -> URL? {
        guard let base = auth.serverURL,
              var comps = URLComponents(url: base.appending(path: "api/v1/" + path), resolvingAgainstBaseURL: false) else { return nil }
        if !items.isEmpty { comps.queryItems = items }
        return comps.url
    }

    private func peek<T: Decodable>(_ path: String, _ items: [URLQueryItem]) -> T? {
        guard let u = url(path, items), let d = ResponseCache.get(u.absoluteString) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }

    private func get<T: Decodable>(_ path: String, _ params: [String: String?]) async throws -> T {
        try await get(path, Self.items(params))
    }

    private func get<T: Decodable>(_ path: String, _ items: [URLQueryItem]) async throws -> T {
        guard let u = url(path, items) else { throw AuthError.signedOut }
        for attempt in 0..<2 {
            var req = URLRequest(url: u)
            req.setValue("Bearer \(try await auth.validAccessToken(forceRefresh: attempt > 0))", forHTTPHeaderField: "Authorization")
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && attempt == 0 { continue }
            guard (200..<300).contains(status) else {
                let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                throw AuthError.message(msg ?? "Request failed (\(status)).")
            }
            let out = try JSONDecoder().decode(T.self, from: data)
            ResponseCache.put(u.absoluteString, data)
            return out
        }
        throw AuthError.signedOut
    }
}
