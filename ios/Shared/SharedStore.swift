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

/// A saved chart: what to measure, over which range, drawn how. Pinned ones show on Insights;
/// any saved one can be picked in the Insight widget.
struct InsightSpec: Codable, Identifiable, Hashable {
    enum Scope: String, Codable, CaseIterable { case all, merchant, category, tag }
    enum Chart: String, Codable, CaseIterable { case bar, line, pie }
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
    var scope: Scope = .all
    var value: String = ""          // merchant name, category or tag
    var range: Range = .last_30_days
    var from: Date?                 // custom range only
    var to: Date?
    var chart: Chart = .bar
    var pinned = true

    var title: String {
        let what = scope == .all ? "All spending" : scope == .tag ? "#\(value)" : value
        let when = range == .custom ? customLabel : range.label
        return "\(what) · \(when)"
    }

    private var customLabel: String {
        guard let from, let to else { return "Custom" }
        let f = Date.FormatStyle().day().month(.abbreviated)
        return "\(from.formatted(f)) – \(to.formatted(f))"
    }

    /// Pie slices: categories for a merchant/all, merchants for a category/tag.
    var pieGroup: String { scope == .category || scope == .tag ? "merchant" : "category" }

    /// Time bucket for bars/lines, from the length of the range.
    var timeGroup: String {
        switch range {
        case .today, .last_7_days, .this_month, .last_30_days: return "day"
        case .this_quarter: return "week"
        case .this_year: return "month"
        case .custom:
            let days = (to ?? .now).timeIntervalSince(from ?? .now) / 86400
            return days <= 45 ? "day" : days <= 150 ? "week" : "month"
        }
    }

    /// Query string for /api/v1/breakdown.
    func query(combine: String?) -> [String: String] {
        var q: [String: String] = ["group_by": chart == .pie ? pieGroup : timeGroup]
        if range == .custom {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Singapore")
            if let from { q["from"] = f.string(from: from) }
            if let to { q["to"] = f.string(from: to) }
        } else {
            q["period"] = range.rawValue
        }
        switch scope {
        case .all: break
        case .merchant: q["merchant"] = value
        case .category: q["category"] = value
        case .tag: q["tag"] = value
        }
        if let combine { q["combine"] = combine }
        return q
    }
}

/// Refresh token in a Keychain group both the app and widgets can read.
enum TokenStore {
    private static let service = "com.pranav.finny"
    private static let account = "refreshToken"
    static let accessGroup = "9U72AVU3KH.com.pranav.finny.shared"

    static func save(_ token: String) {
        delete()
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

    static func delete() { SecItemDelete(base() as CFDictionary) }

    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
