import Foundation
import Security

/// State shared between the app and its widgets (App Group + shared Keychain).
enum SharedStore {
    static let groupID = "group.com.pranav.finny"
    static let defaults = UserDefaults(suiteName: groupID) ?? .standard

    static var serverURL: URL? {
        get { defaults.string(forKey: "serverURL").flatMap(URL.init(string:)) }
        set { defaults.set(newValue?.absoluteString, forKey: "serverURL") }
    }

    /// "SGD", "INR", "ALL_SGD", "ALL_INR" (see CurrencyMode in the app).
    static var currencyMode: String {
        get { defaults.string(forKey: "currencyMode") ?? "SGD" }
        set { defaults.set(newValue, forKey: "currencyMode") }
    }

    static var insights: [InsightSpec] {
        get { (defaults.data(forKey: "insights")).flatMap { try? JSONDecoder().decode([InsightSpec].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "insights") }
    }
}

/// A saved chart: one or more series (categories, merchants, tags or everything), over a range,
/// drawn how. Pinned ones show on Insights; any saved one can be picked in the Insight widget.
struct InsightSpec: Codable, Identifiable, Hashable {
    enum Kind: String, Codable, CaseIterable { case all, category, merchant, tag }
    struct Series: Codable, Hashable {
        var kind: Kind
        var value: String = ""
        var label: String { kind == .all ? "All spending" : kind == .tag ? "#\(value)" : kind == .merchant ? prettyMerchant(value) : value }
        var param: String { "\(kind.rawValue):\(value)" }
    }
    enum Chart: String, Codable, CaseIterable {
        case bar, stacked, line, totals, pie
        var label: String {
            switch self { case .bar: "Bars"; case .stacked: "Stacked"; case .line: "Lines"; case .totals: "Totals"; case .pie: "Pie" }
        }
        var hint: String {
            switch self {
            case .bar: "Side by side over time"
            case .stacked: "Combined over time"
            case .line: "Trends over time"
            case .totals: "Compare the totals"
            case .pie: "Share of the whole"
            }
        }
    }
    enum Range: String, Codable, CaseIterable {
        case today, last_7_days, this_month, last_30_days, this_quarter, this_year, custom
        var label: String {
            switch self {
            case .today: "Today"
            case .last_7_days: "7 days"
            case .this_month: "MTD"
            case .last_30_days: "30 days"
            case .this_quarter: "Quarter"
            case .this_year: "Year"
            case .custom: "Custom"
            }
        }
    }

    var id = UUID()
    var series: [Series] = [Series(kind: .all)]
    var range: Range = .last_30_days
    var from: Date?                 // custom range only
    var to: Date?
    var chart: Chart = .bar
    var pinned = true

    init() {}

    var isReady: Bool { !series.isEmpty && series.allSatisfy { $0.kind == .all || !$0.value.isEmpty } }

    var title: String {
        let what = series.map(\.label).joined(separator: " vs ")
        let when = range == .custom ? customLabel : range.label
        return "\(what) · \(when)"
    }

    private var customLabel: String {
        guard let from, let to else { return "Custom" }
        let f = Date.FormatStyle().day().month(.abbreviated)
        return "\(from.formatted(f)) – \(to.formatted(f))"
    }

    /// A pie of a single series splits it up (by category, or by merchant for a category/tag) via /breakdown.
    /// Everything else goes through /compare.
    var usesBreakdown: Bool { chart == .pie && series.count == 1 }

    private var rangeQuery: [URLQueryItem] {
        if range == .custom {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Singapore")
            return [from.map { URLQueryItem(name: "from", value: f.string(from: $0)) }, to.map { URLQueryItem(name: "to", value: f.string(from: $0)) }].compactMap { $0 }
        }
        return [URLQueryItem(name: "period", value: range.rawValue)]
    }

    /// (path, query) for the endpoint that draws this spec.
    func request(combine: String?) -> (String, [URLQueryItem]) {
        var q = rangeQuery
        if let combine { q.append(URLQueryItem(name: "combine", value: combine)) }
        if usesBreakdown, let one = series.first {
            q.append(URLQueryItem(name: "group_by", value: one.kind == .category || one.kind == .tag ? "merchant" : "category"))
            if one.kind != .all { q.append(URLQueryItem(name: one.kind.rawValue, value: one.value)) }
            return ("breakdown", q)
        }
        q += series.map { URLQueryItem(name: "s", value: $0.param) }
        return ("compare", q)
    }

    // Older builds saved a single {scope, value}; read those as one series.
    private enum CodingKeys: String, CodingKey { case id, series, range, from, to, chart, pinned, scope, value }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        if let s = try c.decodeIfPresent([Series].self, forKey: .series) {
            series = s
        } else {
            let kind = (try? c.decodeIfPresent(Kind.self, forKey: .scope)) ?? .all
            series = [Series(kind: kind, value: (try? c.decodeIfPresent(String.self, forKey: .value)) ?? "")]
        }
        range = (try? c.decodeIfPresent(Range.self, forKey: .range)) ?? .last_30_days
        from = try c.decodeIfPresent(Date.self, forKey: .from)
        to = try c.decodeIfPresent(Date.self, forKey: .to)
        chart = (try? c.decodeIfPresent(Chart.self, forKey: .chart)) ?? .bar
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? true
    }

    func encode(to e: Encoder) throws {
        var c = e.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(series, forKey: .series)
        try c.encode(range, forKey: .range)
        try c.encodeIfPresent(from, forKey: .from)
        try c.encodeIfPresent(to, forKey: .to)
        try c.encode(chart, forKey: .chart)
        try c.encode(pinned, forKey: .pinned)
    }
}

/// What an insight draws from: a /compare response, or a /breakdown one for single-series pies.
struct InsightData {
    var compare: Compare?
    var breakdown: [String: Breakdown]?

    func totals(_ currency: String) -> [Double] {
        if let b = breakdown { return [b[currency]?.total ?? 0] }
        return compare?.data[currency]?.series.map(\.total) ?? []
    }
}

/// Refresh token in a Keychain group both the app and widgets can read.
enum TokenStore {
    private static let service = "com.pranav.finny"
    private static let account = "refreshToken"
    static let accessGroup = "9U72AVU3KH.com.pranav.finny.shared"

    static func save(_ token: String) {
        SecItemDelete(base() as CFDictionary)   // refresh token only; the access token stays
        var q = base()
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var shared = q
        shared[kSecAttrAccessGroup as String] = accessGroup
        // Unsigned/simulator builds may lack the shared group; fall back to the app's own group.
        if SecItemAdd(shared as CFDictionary, nil) != errSecSuccess { SecItemAdd(q as CFDictionary, nil) }
    }

    static func read() -> String? {
        var q = base()
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete(base() as CFDictionary)
        SecItemDelete(base("accessToken") as CFDictionary)
    }

    /// The short-lived access token too, so a cold launch can fetch straight away instead of refreshing first.
    static func saveAccess(_ token: String, expiry: Date) {
        SecItemDelete(base("accessToken") as CFDictionary)
        var q = base("accessToken")
        q[kSecValueData as String] = Data("\(expiry.timeIntervalSince1970)|\(token)".utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func readAccess() -> (token: String, expiry: Date)? {
        var q = base("accessToken")
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
              let s = String(data: d, encoding: .utf8), let bar = s.firstIndex(of: "|"),
              let t = Double(s[..<bar]) else { return nil }
        return (String(s[s.index(after: bar)...]), Date(timeIntervalSince1970: t))
    }

    private static func base(_ account: String = account) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
