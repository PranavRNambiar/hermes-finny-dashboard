import Charts
import SwiftUI

/// Draws one saved insight from a /breakdown response. Shared by the Insights tab and widgets.
struct InsightChartView: View {
    let spec: InsightSpec
    let data: Breakdown?
    let currency: String
    var compact = false   // widgets: fewer labels, no legend

    private var groups: [Breakdown.Group] { data?.groups ?? [] }

    var body: some View {
        if groups.isEmpty {
            Text("No spending in this range")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            switch spec.chart {
            case .pie: pie
            case .line: timeChart(line: true)
            case .bar: timeChart(line: false)
            }
        }
    }

    // MARK: Bars / line over time

    private var unit: Calendar.Component {
        switch spec.timeGroup { case "month": .month; case "week": .weekOfYear; default: .day }
    }

    private func date(_ key: String) -> Date {
        DateFormatter.isoDay.date(from: key.count == 7 ? key + "-01" : key) ?? .now
    }

    private func timeChart(line: Bool) -> some View {
        Chart(groups) { g in
            if line {
                AreaMark(x: .value("When", date(g.key), unit: unit), y: .value("Spend", g.total))
                    .foregroundStyle(LinearGradient(colors: [Palette.mint.opacity(0.35), Palette.mint.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.catmullRom)
                LineMark(x: .value("When", date(g.key), unit: unit), y: .value("Spend", g.total))
                    .foregroundStyle(Palette.mint)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .interpolationMethod(.catmullRom)
                if !compact && groups.count <= 31 {
                    PointMark(x: .value("When", date(g.key), unit: unit), y: .value("Spend", g.total))
                        .foregroundStyle(Palette.mint).symbolSize(18)
                }
            } else {
                BarMark(x: .value("When", date(g.key), unit: unit), y: .value("Spend", g.total))
                    .foregroundStyle(Palette.mint.gradient)
                    .cornerRadius(compact ? 2 : 4)
            }
        }
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

    // MARK: Pie

    private var slices: [Breakdown.Group] {
        let top = Array(groups.prefix(5))
        let rest = groups.dropFirst(5)
        guard !rest.isEmpty else { return top }
        let other = Breakdown.Group(key: "Other", total: rest.map(\.total).reduce(0, +), count: rest.map(\.count).reduce(0, +),
                                    share_pct: rest.map(\.share_pct).reduce(0, +))
        return top + [other]
    }

    private static let sliceColors: [Color] = [Palette.mint, Palette.ink, Palette.coral, Color(hex: 0x7C6FE0), Color(hex: 0xF2B544), Palette.muted]

    private var pie: some View {
        HStack(spacing: compact ? 8 : 16) {
            Chart(Array(slices.enumerated()), id: \.element.key) { i, g in
                SectorMark(angle: .value("Spend", g.total), innerRadius: .ratio(0.6), angularInset: 1.5)
                    .cornerRadius(3)
                    .foregroundStyle(Self.sliceColors[i % Self.sliceColors.count])
            }
            .chartBackground { _ in
                VStack(spacing: 0) {
                    Text(Money.format(data?.total ?? 0, currency, compact: true))
                        .font(.system(size: compact ? 11 : 15, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Palette.ink)
                        .minimumScaleFactor(0.6)
                }
            }
            if !compact || slices.count <= 4 {
                VStack(alignment: .leading, spacing: compact ? 3 : 6) {
                    ForEach(Array(slices.enumerated()), id: \.element.key) { i, g in
                        HStack(spacing: 6) {
                            Circle().fill(Self.sliceColors[i % Self.sliceColors.count]).frame(width: 7, height: 7)
                            Text(prettyMerchant(g.key)).font(.system(size: compact ? 9 : 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(Palette.ink).lineLimit(1)
                            Spacer(minLength: 2)
                            Text("\(Int(g.share_pct.rounded()))%").font(.system(size: compact ? 9 : 11, weight: .bold, design: .rounded).monospacedDigit())
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
                .frame(maxWidth: compact ? 90 : 150)
            }
        }
    }
}
