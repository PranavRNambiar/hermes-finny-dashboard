import Charts
import SwiftUI

/// Draws one saved insight: one or more series compared over time, as totals, or as a pie.
/// Shared by the Insights tab and widgets.
struct InsightChartView: View {
    let spec: InsightSpec
    let data: InsightData?
    let currency: String
    var compact = false   // widgets: fewer labels, no legend

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

    private func timeChart(_ b: Compare.Block) -> some View {
        let names = b.series.indices.map { name($0, b) }
        let multi = b.series.count > 1
        let dots = !compact && b.keys.count <= 31
        return Chart(points(b)) { p in
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
            default:
                BarMark(x: .value("When", p.when, unit: unit), y: .value("Spend", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .position(by: .value("Series", p.series))
                    .cornerRadius(compact ? 1.5 : 3)
            }
        }
        .chartForegroundStyleScale(domain: names, range: names.indices.map(Self.color))
        .chartLegend(compact || !multi ? .hidden : .visible)
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

    private func pie(_ slices: [Slice], total: Double) -> some View {
        let sum = max(slices.map(\.total).reduce(0, +), 0.01)
        return HStack(spacing: compact ? 8 : 16) {
            Chart(Array(slices.enumerated()), id: \.offset) { i, s in
                SectorMark(angle: .value("Spend", s.total), innerRadius: .ratio(0.6), angularInset: 1.5)
                    .cornerRadius(3)
                    .foregroundStyle(Self.color(i))
            }
            .chartBackground { _ in
                Text(Money.format(total, currency, compact: true))
                    .font(.system(size: compact ? 11 : 15, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(Palette.ink)
                    .minimumScaleFactor(0.6)
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
                    }
                }
                .frame(maxWidth: compact ? 90 : 150)
            }
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
