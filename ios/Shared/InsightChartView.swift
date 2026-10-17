import Charts
import SwiftUI

/// Draws one saved insight: one or more series compared over time, as totals, or as a pie.
/// Shared by the Insights tab and widgets.
struct InsightChartView: View {
    let spec: InsightSpec
    let data: InsightData?
    let currency: String
    var compact = false   // widgets: fewer labels, no legend, no touch

    @State private var selected: Date?        // touch-and-drag crosshair on time charts
    @State private var angle: Double?         // tapped pie slice

    static let colors: [Color] = [Palette.mint, Color(hex: 0x7C6FE0), Palette.coral, Color(hex: 0x3B82F6),
                                  Color(hex: 0xF2B544), Color(hex: 0xEC4899), Palette.inkSoft, Color(hex: 0x14B8A6)]
    static func color(_ i: Int) -> Color { colors[i % colors.count] }

    private var block: Compare.Block? { data?.compare?.data[currency] }

    var body: some View {
        if spec.usesBreakdown {
            let groups = data?.breakdown?[currency]?.groups ?? []
            if groups.isEmpty { empty } else { pie(Self.slices(groups), total: data?.breakdown?[currency]?.total ?? 0) }
        } else if let b = block, b.series.contains(where: { $0.total > 0 }) {
            switch spec.chart {
            case .pie: pie(b.series.indices.map { Slice(label: name($0, b), total: b.series[$0].total) },
                           total: b.series.map(\.total).reduce(0, +))
            case .totals: totals(b)
            case .line, .bar, .stacked: timeChart(b)
            }
        } else {
            empty
        }
    }

    private var empty: some View {
        Text(data == nil ? " " : "No spending in this range")
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func name(_ i: Int, _ b: Compare.Block) -> String { spec.series[safe: i]?.label ?? b.series[i].label }

    // MARK: Over time

    private var unit: Calendar.Component {
        switch data?.compare?.group_by { case "month": .month; case "week": .weekOfYear; default: .day }
    }

    private func date(_ key: String) -> Date {
        DateFormatter.isoDay.date(from: key.count == 7 ? key + "-01" : key) ?? .now
    }

    private struct Point: Identifiable { let id: String; let series: String; let when: Date; let value: Double }

    private func points(_ b: Compare.Block) -> [Point] {
        b.series.indices.flatMap { si in
            b.keys.indices.map { ki in Point(id: "\(si)-\(ki)", series: name(si, b), when: date(b.keys[ki]), value: b.series[si].points[ki]) }
        }
    }

    /// Index of the bucket a touched date falls in.
    private func bucketIndex(_ d: Date, _ b: Compare.Block) -> Int? {
        b.keys.lastIndex { date($0) <= d } ?? (b.keys.isEmpty ? nil : 0)
    }

    private var visibleLength: TimeInterval {
        switch unit { case .month: 86400 * 366; case .weekOfYear: 86400 * 7 * 16; default: 86400 * 31 }
    }

    private func timeChart(_ b: Compare.Block) -> some View {
        let names = b.series.indices.map { name($0, b) }
        let multi = b.series.count > 1
        let dots = !compact && b.keys.count <= 31
        let pick = selected.flatMap { bucketIndex($0, b) }
        let scrolls = !compact && b.keys.count > (unit == .month ? 12 : unit == .weekOfYear ? 16 : 31)
        return Chart {
            ForEach(points(b)) { p in
                switch spec.chart {
                case .line:
                    LineMark(x: .value("When", p.when, unit: unit), y: .value("Spend", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.catmullRom)
                        .symbol { if dots { Circle().frame(width: 4, height: 4) } }
                case .stacked:
                    BarMark(x: .value("When", p.when, unit: unit), y: .value("Spend", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .opacity(pick == nil || date(b.keys[pick!]) == p.when ? 1 : 0.35)
                default:
                    BarMark(x: .value("When", p.when, unit: unit), y: .value("Spend", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series))
                        .cornerRadius(compact ? 1.5 : 3)
                        .opacity(pick == nil || date(b.keys[pick!]) == p.when ? 1 : 0.35)
                }
            }
            if let i = pick {
                RuleMark(x: .value("When", date(b.keys[i]), unit: unit))
                    .foregroundStyle(Palette.muted.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        callout(b, i, names: names)
                    }
            }
        }
        .chartForegroundStyleScale(domain: names, range: names.indices.map(Self.color))
        .chartLegend(compact || !multi ? .hidden : .visible)
        .chartXSelection(value: $selected)
        .modifier(Scrolling(on: scrolls, length: visibleLength, end: b.keys.last.map(date)))
        .sensoryFeedback(.selection, trigger: pick)
        .chartYAxis {
            AxisMarks(position: .trailing) { _ in
                AxisGridLine().foregroundStyle(Palette.hairline)
                if !compact {
                    AxisValueLabel(format: FloatingPointFormatStyle<Double>.number.notation(.compactName)).foregroundStyle(Palette.muted)
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: compact ? 3 : 5)) { _ in
                AxisValueLabel(format: unit == .month ? .dateTime.month(.abbreviated) : .dateTime.day().month(.abbreviated))
                    .foregroundStyle(Palette.muted)
                    .font(.system(size: compact ? 8 : 10, weight: .semibold, design: .rounded))
            }
        }
    }

    /// The floating card for a touched bucket: its date and each series' amount.
    private func callout(_ b: Compare.Block, _ i: Int, names: [String]) -> some View {
        let d = date(b.keys[i])
        let when = unit == .month ? d.formatted(.dateTime.month(.wide).year())
            : unit == .weekOfYear ? "Week of " + d.formatted(.dateTime.day().month(.abbreviated))
            : d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        return VStack(alignment: .leading, spacing: 3) {
            Text(when).font(.system(size: 10, weight: .bold, design: .rounded)).foregroundStyle(Palette.surface.opacity(0.65))
            ForEach(b.series.indices, id: \.self) { si in
                HStack(spacing: 5) {
                    Circle().fill(Self.color(si)).frame(width: 6, height: 6)
                    if b.series.count > 1 { Text(names[si]).lineLimit(1) }
                    Spacer(minLength: 6)
                    Text(Money.format(b.series[si].points[i], currency)).monospacedDigit()
                }
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(Palette.surface)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .frame(minWidth: 110, maxWidth: 200)
        .background(Palette.ink, in: .rect(cornerRadius: 10, style: .continuous))
    }

    // MARK: Totals (best for Today)

    private func totals(_ b: Compare.Block) -> some View {
        let top = b.series.map(\.total).max() ?? 1
        return VStack(alignment: .leading, spacing: compact ? 6 : 12) {
            ForEach(b.series.indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(name(i, b)).font(.system(size: compact ? 10 : 13, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink).lineLimit(1)
                        if !compact { Text("· \(b.series[i].count)×").font(.system(size: 12, design: .rounded)).foregroundStyle(Palette.muted) }
                        Spacer(minLength: 4)
                        Text(Money.format(b.series[i].total, currency, compact: compact))
                            .font(.system(size: compact ? 10 : 14, weight: .bold, design: .rounded).monospacedDigit()).foregroundStyle(Palette.ink)
                    }
                    GeometryReader { g in
                        Capsule().fill(Palette.hairline)
                            .overlay(alignment: .leading) {
                                Capsule().fill(Self.color(i)).frame(width: top > 0 ? g.size.width * b.series[i].total / top : 0)
                            }
                    }
                    .frame(height: compact ? 6 : 10)
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: Pie

    struct Slice { let label: String; let total: Double }

    private static func slices(_ groups: [Breakdown.Group]) -> [Slice] {
        let top = groups.prefix(5).map { Slice(label: prettyMerchant($0.key), total: $0.total) }
        let rest = groups.dropFirst(5)
        return rest.isEmpty ? top : top + [Slice(label: "Other", total: rest.map(\.total).reduce(0, +))]
    }

    /// Which slice a tapped angle lands on.
    private func sliceIndex(_ slices: [Slice]) -> Int? {
        guard let angle else { return nil }
        var run = 0.0
        for (i, s) in slices.enumerated() { run += s.total; if angle <= run { return i } }
        return nil
    }

    private func pie(_ slices: [Slice], total: Double) -> some View {
        let sum = max(slices.map(\.total).reduce(0, +), 0.01)
        let pick = compact ? nil : sliceIndex(slices)
        return HStack(spacing: compact ? 8 : 16) {
            Chart(Array(slices.enumerated()), id: \.offset) { i, s in
                SectorMark(angle: .value("Spend", s.total), innerRadius: .ratio(pick == i ? 0.56 : 0.6),
                           outerRadius: .ratio(pick == i ? 1 : 0.94), angularInset: 1.5)
                    .cornerRadius(3)
                    .foregroundStyle(Self.color(i))
                    .opacity(pick == nil || pick == i ? 1 : 0.35)
            }
            .chartAngleSelection(value: $angle)
            .sensoryFeedback(.selection, trigger: pick)
            .chartBackground { _ in
                VStack(spacing: 1) {
                    if let i = pick {
                        Text(slices[i].label).font(.system(size: 10, weight: .bold, design: .rounded)).foregroundStyle(Palette.muted).lineLimit(1)
                        Text(Money.format(slices[i].total, currency, compact: true))
                            .font(.system(size: 15, weight: .bold, design: .rounded).monospacedDigit()).foregroundStyle(Palette.ink)
                        Text("\(Int((slices[i].total / sum * 100).rounded()))%").font(.system(size: 10, weight: .bold, design: .rounded)).foregroundStyle(Self.color(i))
                    } else {
                        Text(Money.format(total, currency, compact: true))
                            .font(.system(size: compact ? 11 : 15, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(Palette.ink)
                    }
                }
                .minimumScaleFactor(0.6)
                .frame(maxWidth: 80)
            }
            if !compact || slices.count <= 4 {
                VStack(alignment: .leading, spacing: compact ? 3 : 6) {
                    ForEach(Array(slices.enumerated()), id: \.offset) { i, s in
                        HStack(spacing: 6) {
                            Circle().fill(Self.color(i)).frame(width: 7, height: 7)
                            Text(s.label).font(.system(size: compact ? 9 : 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(Palette.ink).lineLimit(1)
                            Spacer(minLength: 2)
                            Text("\(Int((s.total / sum * 100).rounded()))%").font(.system(size: compact ? 9 : 11, weight: .bold, design: .rounded).monospacedDigit())
                                .foregroundStyle(Palette.muted)
                        }
                        .opacity(pick == nil || pick == i ? 1 : 0.4)
                    }
                }
                .frame(maxWidth: compact ? 90 : 150)
            }
        }
    }
}

/// Horizontal scrolling for long ranges, starting at the most recent data.
private struct Scrolling: ViewModifier {
    let on: Bool
    let length: TimeInterval
    let end: Date?
    func body(content: Content) -> some View {
        if on, let end {
            content
                .chartScrollableAxes(.horizontal)
                .chartXVisibleDomain(length: length)
                .chartScrollPosition(initialX: end.addingTimeInterval(-length))
        } else {
            content
        }
    }
}

/// The headline above an insight: one total, or one per series in its colour.
struct InsightTotals: View {
    let spec: InsightSpec
    let data: InsightData?
    let currency: String
    var size: CGFloat = 26

    var body: some View {
        let totals = data?.totals(currency) ?? []
        if totals.count <= 1 {
            AmountText(amount: totals.first ?? 0, currency: currency, size: size, weight: .bold)
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(totals.indices, id: \.self) { i in
                        HStack(spacing: 5) {
                            Circle().fill(InsightChartView.color(i)).frame(width: 8, height: 8)
                            AmountText(amount: totals[i], currency: currency, size: 18, weight: .bold)
                        }
                    }
                }
            }
        }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
