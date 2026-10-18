import Foundation

// Mirrors the JSON from dashboard/lib/finny/data.ts. SGD and INR are always kept apart.

struct Txn: Decodable, Identifiable, Hashable {
    let id: String
    let card: String
    let currency: String
    let amount: Double
    let merchant: String?
    let category: String
    let txn_date: String
    let txn_time: String?
    let anomaly_flagged: Bool
    let user_tag: String?
    let raw_desc: String?
    let raw_merchant: String?
    /// Full card charge; `amount` is your share after splits.
    let total_amount: Double?
    let split_with: Int?
    let splits: [Split]?
    /// Foreign spends: what was paid abroad (e.g. EUR 21.46). `amount` is converted.
    let orig_currency: String?
    let orig_amount: Double?
    let fx_rate: Double?

    /// "€21.46" for a foreign spend, else nil.
    var foreignLabel: String? {
        guard let c = orig_currency, let a = orig_amount else { return nil }
        return Money.symbol(c) + a.formatted(.number.precision(.fractionLength(2)))
    }

    var isSplit: Bool { (split_with ?? 0) > 0 }
    var fullAmount: Double { total_amount ?? amount }

    /// Custom names (set in the app) are shown exactly as typed; bank names get tidied.
    var displayMerchant: String {
        guard let m = merchant?.nilIfEmpty else { return "Unknown merchant" }
        return isRenamed ? m : prettyMerchant(m)
    }
    var isRenamed: Bool { raw_merchant != nil && raw_merchant != merchant }
    var date: Date { DateFormatter.isoDay.date(from: txn_date) ?? .now }

    struct Split: Decodable, Hashable {
        let split_id: Int?
        let person_id: Int?
        let person: String?
        let share_amount: Double
        let currency: String
        let status: String
    }
}

struct KeyTotal: Decodable, Hashable, Identifiable {
    let key: String
    let total: Double
    var id: String { key }
}

struct DailyPoint: Decodable, Hashable, Identifiable {
    let date: String
    let total: Double
    var id: String { date }
    var day: Date { DateFormatter.isoDay.date(from: date) ?? .now }
}

struct CurrencySummary: Decodable {
    let total: Double
    let count: Int
    let previous_period_total: Double
    let change_pct: Double?
    let avg_per_day: Double
    let by_category: [KeyTotal]
    let top_merchants: [KeyTotal]
    let by_card: [KeyTotal]
    let daily: [DailyPoint]
    let largest: [Txn]
}

struct Overview: Decodable {
    struct PeriodInfo: Decodable {
        let name: String
        let from: String
        let to: String
        let label: String
        let days: Int
    }
    struct Combined: Decodable {
        let currency: String
        let fx_rate: Double?
        let fx_date: String?
    }
    struct CashFlow: Decodable {
        let in_total: Double
        let out_total: Double
        let net: Double
        let in_by_kind: [String: Double]
        let in_count: Int
    }
    let period: PeriodInfo
    let combined: Combined?
    let cash_flow: [String: CashFlow]?
    struct Excluded: Decodable { let total: Double; let count: Int }
    let excluded: [String: Excluded]?
    let currencies: [String: CurrencySummary]
    let anomalies: [Txn]
}

struct TxnPage: Decodable {
    let transactions: [Txn]
    let total: Int
    /// How the server read the search, e.g. "August 2026 · Food & Drink".
    var interpreted: String?
    var totals: [String: Double]?
}

/// /api/v1/compare: per currency, one row of points per series over shared time buckets.
struct Compare: Decodable {
    struct Series: Decodable, Hashable { let label: String; let kind: String; let total: Double; let count: Int; let points: [Double] }
    struct Block: Decodable { let keys: [String]; let series: [Series] }
    let from: String
    let to: String
    let group_by: String
    let data: [String: Block]
}

struct Breakdown: Decodable {
    struct Group: Decodable, Identifiable, Hashable {
        let key: String
        let total: Double
        let count: Int
        let share_pct: Double
        var id: String { key }
    }
    let total: Double
    let count: Int
    let groups: [Group]
}

struct Splits: Decodable {
    struct Person: Decodable, Identifiable {
        struct Item: Decodable, Identifiable {
            let split_id: Int
            let merchant: String?
            let txn_date: String?
            let share_amount: Double
            var id: Int { split_id }
        }
        let person_id: Int?
        let name: String
        let currency: String
        let total: Double
        let items: [Item]
        var id: String { "\(name)-\(currency)" }
    }
    let owed_to_me: [Person]
    let totals_by_currency: [String: Double]
}

struct Subscription: Decodable, Identifiable {
    let merchant: String
    let currency: String
    let avg_amount: Double
    let avg_gap_days: Int
    let occurrences: Int
    let last_charged: String
    let card: String
    var id: String { "\(currency)-\(merchant)" }
}

struct Meta: Decodable {
    struct Card: Decodable, Identifiable, Hashable {
        let card: String
        let label: String
        let currency: String
        let active: Bool
        var id: String { card }
    }
    struct Named: Decodable, Identifiable, Hashable {
        let name: String
        let count: Int
        var id: String { name }
    }
    struct FX: Decodable {
        let rate: Double
        let date: String
    }
    let cards: [Card]
    let categories: [Named]
    let tags: [Named]
    let fx: FX?
}

/// Which currency the screens show: one card currency, or everything converted into one.
enum CurrencyMode: String, CaseIterable, Identifiable {
    case sgd = "SGD", inr = "INR", allSGD = "ALL_SGD", allINR = "ALL_INR"
    var id: String { rawValue }
    var currency: String { self == .sgd || self == .allSGD ? "SGD" : "INR" }
    var combine: String? { self == .allSGD ? "SGD" : self == .allINR ? "INR" : nil }
    var isCombined: Bool { combine != nil }
    var label: String {
        switch self {
        case .sgd: "SGD"
        case .inr: "INR"
        case .allSGD: "All in S$"
        case .allINR: "All in ₹"
        }
    }
}

let allCategories = [
    "Food & Drink", "Transport", "Shopping", "Subscriptions", "Health & Fitness", "Travel",
    "Utilities & Bills", "Rent & Housing", "Entertainment", "Education", "Gifts", "Transfers & Misc", "Exclusions",
]

/// Category for big one-offs (e.g. tuition): shown, but left out of every spending total.
let excludedCategory = "Exclusions"

enum Period: String, CaseIterable, Identifiable {
    case today, last_7_days, this_week, this_month, last_month, last_30_days, this_quarter, this_year

    /// The quick picker on Overview.
    static let overview: [Period] = [.last_7_days, .this_month, .last_month, .last_30_days, .this_year]
    var id: String { rawValue }
    var short: String {
        switch self {
        case .today: "Today"
        case .last_7_days: "7D"
        case .this_week: "Week"
        case .this_quarter: "Quarter"
        case .this_month: "Month"
        case .last_month: "Last mo"
        case .last_30_days: "30D"
        case .this_year: "Year"
        }
    }
}

/// A saved stretch of time to track on Overview, e.g. a trip. Kept until edited.
struct CustomRange: Codable, Equatable {
    var name = ""
    var from = Date.now
    var to: Date?          // nil = ongoing, up to today

    var short: String {
        if !name.isEmpty { return name }
        let f = Date.FormatStyle().day().month(.abbreviated)
        return "\(from.formatted(f))–\(to.map { $0.formatted(f) } ?? "now")"
    }

    func params(combine: String?) -> [String: String?] {
        ["from": DateFormatter.isoDay.string(from: from), "to": to.map { DateFormatter.isoDay.string(from: $0) },
         "label": name.isEmpty ? nil : name, "combine": combine]
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Bank alerts shout ("KOUFU @ SMU"). Title-case only all-caps names and keep short
/// all-caps tokens (SMU, DBS, LLP) as acronyms; leave mixed-case names as the bank sent them.
func prettyMerchant(_ raw: String) -> String {
    guard raw == raw.uppercased(), raw.contains(where: \.isLetter) else { return raw }
    return raw.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
        let letters = word.filter(\.isLetter)
        if letters.count <= 3 && !letters.isEmpty && !["THE", "AND", "PTE", "LTD"].contains(String(letters)) { return String(word) }
        return word.capitalized
    }.joined(separator: " ")
}

extension DateFormatter {
    static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Singapore")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct Incoming: Decodable, Identifiable, Hashable {
    let id: String
    let card: String
    let currency: String
    let amount: Double
    let counterparty: String?
    let kind: String
    let txn_date: String
    let txn_time: String?
    var date: Date { DateFormatter.isoDay.date(from: txn_date) ?? .now }
    var name: String { (counterparty?.nilIfEmpty).map(prettyMerchant) ?? "Unknown" }
}

struct IncomingPage: Decodable { let incoming: [Incoming] }
struct Person: Decodable, Identifiable, Hashable { let id: Int; let name: String }
struct PeoplePage: Decodable { let people: [Person] }

enum IncomingKind: String, CaseIterable, Identifiable {
    case salary, transfer, refund, own_transfer
    var id: String { rawValue }
    var label: String {
        switch self {
        case .salary: "Salary"
        case .transfer: "Transfer in"
        case .refund: "Refund"
        case .own_transfer: "Own transfer"
        }
    }
    var symbol: String {
        switch self {
        case .salary: "briefcase.fill"
        case .transfer: "arrow.down.left"
        case .refund: "arrow.uturn.backward"
        case .own_transfer: "arrow.left.arrow.right"
        }
    }
}

struct MerchantInfo: Decodable, Identifiable, Hashable {
    let name: String
    let count: Int
    let last: String
    let totals: [String: Double]
    let renamed: Bool
    var id: String { name }
}
struct MerchantPage: Decodable { let merchants: [MerchantInfo] }

/// Lets shared UI (pickers) trigger the app's haptics/sounds without depending on app-only code.
enum FeedbackHook {
    @MainActor static var select: () -> Void = {}
}

struct Settlement: Decodable, Identifiable, Hashable {
    struct Item: Decodable, Hashable { let split_id: Int; let merchant: String?; let txn_date: String?; let share_amount: Double }
    let person_id: Int
    let name: String
    let settled_at: String
    let currency: String
    let total: Double
    let items: [Item]
    var id: String { "\(person_id)|\(settled_at)" }
    var date: Date {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: settled_at) ?? ISO8601DateFormatter().date(from: settled_at) ?? .now
    }
}
struct SettlementPage: Decodable { let settlements: [Settlement] }
