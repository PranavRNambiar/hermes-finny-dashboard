import AppIntents
import SwiftUI
import WidgetKit

@main
struct FinnyWidgets: WidgetBundle {
    var body: some Widget {
        SpendWidget()
        InsightWidget()
    }
}

/// Which currency view the app is in (shared through the App Group).
enum WidgetCurrency {
    static var mode: String { SharedStore.currencyMode }
    static var currency: String { mode.hasSuffix("INR") ? "INR" : "SGD" }
    static var combine: String? { mode.hasPrefix("ALL_") ? currency : nil }
    static var label: String { combine == nil ? currency : "All in \(Money.symbol(currency))" }
}

// MARK: - Tap-to-change intents (iOS 17 interactive widgets)

/// Tapping a period on the Spend widget switches what it highlights.
struct SetSpendPeriod: AppIntent {
    static let title: LocalizedStringResource = "Show spend for period"
    @Parameter(title: "Period") var period: SpendPeriod
    init() {}
    init(_ p: SpendPeriod) { period = p }
    func perform() async throws -> some IntentResult {
        SharedStore.defaults.set(period.rawValue, forKey: "widget.spendPeriod")
        return .result()
    }
}

/// Tapping a range chip on an Insight widget re-draws it for that range (the saved insight is untouched).
struct SetInsightRange: AppIntent {
    static let title: LocalizedStringResource = "Change insight range"
    @Parameter(title: "Insight") var insightID: String
    @Parameter(title: "Range") var range: String
    init() {}
    init(id: String, range: InsightSpec.Range) { insightID = id; self.range = range.rawValue }
    func perform() async throws -> some IntentResult {
        SharedStore.defaults.set(range, forKey: "widget.range.\(insightID)")
        return .result()
    }
}

// MARK: - Spend widget

enum SpendPeriod: String, AppEnum {
    case today, this_week, this_month
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Period"
    static let caseDisplayRepresentations: [SpendPeriod: DisplayRepresentation] = [
        .today: "Today", .this_week: "This week", .this_month: "Month to date",
    ]
    var short: String { self == .today ? "Today" : self == .this_week ? "This week" : "MTD" }
}

struct SpendConfig: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Spend"
    static let description = IntentDescription("Your spending today, this week or this month.")
    @Parameter(title: "Period", default: .today) var period: SpendPeriod
}

struct SpendEntry: TimelineEntry {
    let date: Date
    let period: SpendPeriod
    let totals: [String: Double]?   // range → amount in the widget's currency
    let counts: [String: Int]?
    let error: String?
}

struct SpendProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SpendEntry {
        SpendEntry(date: .now, period: .today, totals: ["today": 42.5, "this_week": 318.2, "this_month": 1184.27], counts: ["today": 3], error: nil)
    }
    /// A period tapped on the widget wins over the one picked in its settings.
    private func period(_ c: SpendConfig) -> SpendPeriod {
        SharedStore.defaults.string(forKey: "widget.spendPeriod").flatMap(SpendPeriod.init(rawValue:)) ?? c.period
    }
    func snapshot(for configuration: SpendConfig, in context: Context) async -> SpendEntry {
        context.isPreview ? placeholder(in: context) : await load(period(configuration))
    }
    func timeline(for configuration: SpendConfig, in context: Context) async -> Timeline<SpendEntry> {
        let entry = await load(period(configuration))
        // WidgetKit budgets refreshes; the app also reloads widgets whenever it sees new data.
        return Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60)))
    }

    private func load(_ period: SpendPeriod) async -> SpendEntry {
        do {
            let s = try await FinnyClient.summary(combine: WidgetCurrency.combine)
            let ccy = WidgetCurrency.currency
            var totals: [String: Double] = [:], counts: [String: Int] = [:]
            for r in ["today", "this_week", "this_month"] {
                totals[r] = s.totals[r]?[ccy]?.total ?? 0
                counts[r] = s.totals[r]?[ccy]?.count ?? 0
            }
            return SpendEntry(date: .now, period: period, totals: totals, counts: counts, error: nil)
        } catch FinnyClient.Failure.signedOut {
            return SpendEntry(date: .now, period: period, totals: nil, counts: nil, error: "Open Finny to sign in")
        } catch {
            return SpendEntry(date: .now, period: period, totals: nil, counts: nil, error: "Couldn't refresh")
        }
    }
}

struct SpendWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FinnySpend", intent: SpendConfig.self, provider: SpendProvider()) { entry in
            SpendWidgetView(entry: entry)
                .widgetURL(URL(string: "finny://overview"))
                .containerBackground(for: .widget) {
                    LinearGradient(colors: [Palette.inkCardHighlight, Palette.inkCard], startPoint: .topTrailing, endPoint: .bottomLeading)
                }
        }
        .configurationDisplayName("Spend")
        .description("Today, this week or month-to-date spend. Medium shows all three.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct SpendWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SpendEntry
    private var ccy: String { WidgetCurrency.currency }

    var body: some View {
        if let error = entry.error {
            VStack(alignment: .leading, spacing: 6) {
                Text("finny").font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(Palette.mint)
                Spacer()
                Text(error).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(.white.opacity(0.75))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else if family == .systemMedium {
            VStack(alignment: .leading, spacing: 10) {
                header
                HStack(alignment: .bottom, spacing: 14) {
                    ForEach([SpendPeriod.today, .this_week, .this_month], id: \.self) { p in
                        Button(intent: SetSpendPeriod(p)) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(p.short.uppercased()).font(.system(size: 9, weight: .bold, design: .rounded)).tracking(1)
                                    .foregroundStyle(p == entry.period ? Palette.mint : .white.opacity(0.5))
                                AmountText(amount: entry.totals?[p.rawValue] ?? 0, currency: ccy, size: p == entry.period ? 24 : 17, weight: .bold, color: .white)
                                Text("\(entry.counts?[p.rawValue] ?? 0) txns").font(.system(size: 9, weight: .medium, design: .rounded))
                                    .foregroundStyle(.white.opacity(p == entry.period ? 0.6 : 0.35))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 0)
                footer
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                header
                Spacer(minLength: 0)
                Button(intent: SetSpendPeriod(entry.period == .today ? .this_week : entry.period == .this_week ? .this_month : .today)) {
                    HStack(spacing: 3) {
                        Text(entry.period.short.uppercased()).tracking(1.2)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .heavy))
                    }
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(Palette.mint)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Palette.mint.opacity(0.15), in: .capsule)
                }
                .buttonStyle(.plain)
                AmountText(amount: entry.totals?[entry.period.rawValue] ?? 0, currency: ccy, size: 30, weight: .bold, color: .white)
                Text("\(entry.counts?[entry.period.rawValue] ?? 0) transactions")
                    .font(.system(size: 11, weight: .medium, design: .rounded)).foregroundStyle(.white.opacity(0.55))
                footer
            }
        }
    }

    private var header: some View {
        HStack {
            Text("finny").font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundStyle(Palette.mint)
            Spacer()
            Text(WidgetCurrency.label).font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(.white.opacity(0.5))
        }
    }

    private var footer: some View {
        Text("Updated \(entry.date.formatted(date: .omitted, time: .shortened))")
            .font(.system(size: 9, weight: .medium, design: .rounded)).foregroundStyle(.white.opacity(0.4))
    }
}

// MARK: - Insight widget

struct InsightEntity: AppEntity {
    let id: String
    let title: String
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Insight"
    static let defaultQuery = InsightQuery()
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct InsightQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [InsightEntity] {
        SharedStore.insights.filter { identifiers.contains($0.id.uuidString) }.map { InsightEntity(id: $0.id.uuidString, title: $0.title) }
    }
    func suggestedEntities() async throws -> [InsightEntity] {
        SharedStore.insights.map { InsightEntity(id: $0.id.uuidString, title: $0.title) }
    }
    func defaultResult() async -> InsightEntity? {
        SharedStore.insights.first.map { InsightEntity(id: $0.id.uuidString, title: $0.title) }
    }
}

struct InsightConfig: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Insight"
    static let description = IntentDescription("One of the insights you built in Finny.")
    @Parameter(title: "Insight") var insight: InsightEntity?
}

struct InsightEntry: TimelineEntry {
    let date: Date
    let spec: InsightSpec?
    let data: InsightData?
    let error: String?
}

struct InsightProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> InsightEntry {
        let pts: [Double] = [12, 30, 8, 44, 20, 16, 36]
        let block = Compare.Block(keys: (1...7).map { "2026-10-0\($0)" },
                                  series: [Compare.Series(label: "All spending", kind: "all", total: 166, count: 7, points: pts)])
        let data = InsightData(compare: Compare(from: "2026-10-01", to: "2026-10-07", group_by: "day", data: [WidgetCurrency.currency: block]))
        return InsightEntry(date: .now, spec: InsightSpec(), data: data, error: nil)
    }
    func snapshot(for configuration: InsightConfig, in context: Context) async -> InsightEntry {
        context.isPreview ? placeholder(in: context) : await load(configuration)
    }
    func timeline(for configuration: InsightConfig, in context: Context) async -> Timeline<InsightEntry> {
        Timeline(entries: [await load(configuration)], policy: .after(.now.addingTimeInterval(30 * 60)))
    }

    private func load(_ config: InsightConfig) async -> InsightEntry {
        let all = SharedStore.insights
        guard var spec = all.first(where: { $0.id.uuidString == config.insight?.id }) ?? all.first else {
            return InsightEntry(date: .now, spec: nil, data: nil, error: "Build an insight in Finny → Insights")
        }
        if let r = SharedStore.defaults.string(forKey: "widget.range.\(spec.id.uuidString)").flatMap(InsightSpec.Range.init(rawValue:)), r != .custom {
            spec.range = r
        }
        do {
            let d = try await FinnyClient.insight(spec, combine: WidgetCurrency.combine)
            return InsightEntry(date: .now, spec: spec, data: d, error: nil)
        } catch {
            return InsightEntry(date: .now, spec: spec, data: nil, error: "Open Finny to refresh")
        }
    }
}

struct InsightWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FinnyInsight", intent: InsightConfig.self, provider: InsightProvider()) { entry in
            InsightWidgetView(entry: entry)
                .widgetURL(URL(string: "finny://insights/\(entry.spec?.id.uuidString ?? "")"))
                .containerBackground(Palette.surface, for: .widget)
        }
        .configurationDisplayName("Insight")
        .description("A chart you built in Finny's Insights tab.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct InsightWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: InsightEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let spec = entry.spec {
                Text(spec.title.uppercased()).font(.system(size: 9, weight: .bold, design: .rounded)).tracking(1)
                    .foregroundStyle(Palette.muted).lineLimit(1)
                HStack(alignment: .center) {
                    totals
                    Spacer(minLength: 4)
                    if family != .systemSmall { rangeChips(spec) }
                }
                if family == .systemSmall { rangeChips(spec) }
                if let error = entry.error {
                    Spacer()
                    Text(error).font(.caption2).foregroundStyle(Palette.muted)
                } else {
                    InsightChartView(spec: spec, data: entry.data, currency: WidgetCurrency.currency, compact: family != .systemLarge)
                }
            } else {
                Text("finny").font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundStyle(Palette.mint)
                Spacer()
                Text(entry.error ?? "").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(Palette.inkSoft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Tap to redraw the widget for another range.
    private func rangeChips(_ spec: InsightSpec) -> some View {
        let options: [InsightSpec.Range] = family == .systemSmall ? [.last_7_days, .this_month] : [.today, .last_7_days, .this_month, .last_30_days]
        return HStack(spacing: 4) {
            ForEach(options, id: \.self) { r in
                Button(intent: SetInsightRange(id: spec.id.uuidString, range: r)) {
                    Text(r.label)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(spec.range == r ? Palette.surface : Palette.inkSoft)
                        .padding(.horizontal, 7).padding(.vertical, 4)
                        .background(spec.range == r ? Palette.ink : Palette.hairline.opacity(0.6), in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var totals: some View {
        let t = entry.data?.totals(WidgetCurrency.currency) ?? [0]
        if t.count <= 1 {
            AmountText(amount: t.first ?? 0, currency: WidgetCurrency.currency, size: family == .systemSmall ? 20 : 24, weight: .bold)
        } else {
            HStack(spacing: 8) {
                ForEach(t.indices.prefix(family == .systemSmall ? 2 : 4), id: \.self) { i in
                    HStack(spacing: 3) {
                        Circle().fill(InsightChartView.color(i)).frame(width: 6, height: 6)
                        Text(Money.format(t[i], WidgetCurrency.currency, compact: true))
                            .font(.system(size: 13, weight: .bold, design: .rounded).monospacedDigit()).foregroundStyle(Palette.ink)
                    }
                }
            }
            .lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}
