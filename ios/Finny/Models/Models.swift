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
    let splits: [Split]?

    var displayMerchant: String { (merchant?.nilIfEmpty).map(prettyMerchant) ?? "Unknown merchant" }
    var date: Date { DateFormatter.isoDay.date(from: txn_date) ?? .now }

    struct Split: Decodable, Hashable {
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
    let period: PeriodInfo
    let currencies: [String: CurrencySummary]
    let anomalies: [Txn]
}

struct TxnPage: Decodable {
    let transactions: [Txn]
    let total: Int
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

enum Period: String, CaseIterable, Identifiable {
    case last_7_days, this_month, last_month, last_30_days, this_year
    var id: String { rawValue }
    var short: String {
        switch self {
        case .last_7_days: "7D"
        case .this_month: "Month"
        case .last_month: "Last mo"
        case .last_30_days: "30D"
        case .this_year: "Year"
        }
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
