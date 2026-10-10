import Charts
import SwiftUI

struct InsightsView: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    @AppStorage("currencyMode") private var mode: CurrencyMode = .sgd
    @State private var monthly: [String: Breakdown] = [:]
    @State private var tags: [String: Breakdown] = [:]
    @State private var subs: [Subscription] = []
    @State private var splits: Splits?
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(eyebrow: "The bigger picture", title: "Insights") {
                        CurrencyPicker(mode: $mode)
                    }
                    if let error, !loaded {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if !loaded {
                        ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, minHeight: 300)
                    } else {
                        trend
                        tagsCard
                        owed
                        subscriptions
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load() }
            .task(id: "\(mode.rawValue)-\(changes.version)") { await load() }
        }
    }

    private func load() async {
        let api = API(auth: auth)
        let from = Calendar.current.date(byAdding: .month, value: -11, to: .now)!
        let fromISO = String(DateFormatter.isoDay.string(from: from).prefix(7)) + "-01"
        do {
            async let m = api.breakdown(groupBy: "month", from: fromISO, combine: mode.combine)
            async let t = api.breakdown(groupBy: "tag", period: "this_month", combine: mode.combine)
            async let s = api.subscriptions()
            async let o = api.splits()
            (monthly, tags, subs, splits) = try await (m, t, s, o)
            withAnimation(.snappy) { loaded = true }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: Monthly trend

    @ViewBuilder private var trend: some View {
        let groups = monthly[currency]?.groups ?? []
        let current = String(DateFormatter.isoDay.string(from: .now).prefix(7))
        Card(title: "Month by month", trailing: mode.label) {
            if groups.isEmpty {
                Text("No data yet.").foregroundStyle(Palette.inkSoft)
            } else {
                let avg = groups.map(\.total).reduce(0, +) / Double(groups.count)
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow("Monthly average")
                    AmountText(amount: avg, currency: currency, size: 30, weight: .bold)
                }
                Chart {
                    ForEach(groups) { g in
                        BarMark(x: .value("Month", monthLabel(g.key)), y: .value("Spend", g.total))
                            .foregroundStyle(g.key == current ? AnyShapeStyle(Palette.mint.gradient) : AnyShapeStyle(Palette.ink.opacity(0.3)))
                            .cornerRadius(6)
                    }
                    RuleMark(y: .value("Average", avg))
                        .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [2, 5]))
                        .foregroundStyle(Palette.inkSoft)
                }
                .chartYAxis {
                    AxisMarks(position: .trailing) { _ in
                        AxisValueLabel(format: FloatingPointFormatStyle<Double>.number.notation(.compactName))
                            .foregroundStyle(Palette.muted)
                    }
                }
                .chartXAxis {
                    AxisMarks { _ in AxisValueLabel().foregroundStyle(Palette.muted).font(.system(size: 10, weight: .semibold, design: .rounded)) }
                }
                .frame(height: 190)
                Text("Spikes are usually one-offs like tuition or flights. Tap a category on Overview to see the culprit.")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private var currency: String { mode.currency }

    // MARK: Tags

    @ViewBuilder private var tagsCard: some View {
        let groups = tags[currency]?.groups ?? []
        let total = tags[currency]?.total ?? 0
        let tagged = groups.filter { $0.key != "(untagged)" }
        Card(title: "Tags · this month", trailing: mode.label) {
            if tagged.isEmpty {
                Text("No tags yet. Open any transaction and tag it, e.g. #date-night or #work. Tag a merchant once and every future visit follows.")
                    .font(.system(size: 13, design: .rounded))
                    .foregroundStyle(Palette.inkSoft)
            } else {
                let taggedTotal = tagged.map(\.total).reduce(0, +)
                HStack(alignment: .firstTextBaseline) {
                    AmountText(amount: taggedTotal, currency: currency, size: 26, weight: .bold)
                    Text("tagged · \(Int((taggedTotal / max(total, 1) * 100).rounded()))% of spend")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(Palette.muted)
                }
                VStack(spacing: 10) {
                    ForEach(tagged.prefix(8)) { g in
                        HStack {
                            Text("#\(g.key)").font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.mint)
                            Text("\(g.count)×").font(.caption).foregroundStyle(Palette.muted)
                            Spacer()
                            AmountText(amount: g.total, currency: currency, size: 15)
                        }
                    }
                }
            }
        }
    }

    private func monthLabel(_ yyyyMm: String) -> String {
        guard let d = DateFormatter.isoDay.date(from: yyyyMm + "-01") else { return yyyyMm }
        return d.formatted(.dateTime.month(.abbreviated)).uppercased()
    }

    // MARK: Splits

    @ViewBuilder private var owed: some View {
        Card(title: "Who owes you") {
            if let splits, !splits.owed_to_me.isEmpty {
                VStack(spacing: 14) {
                    ForEach(splits.owed_to_me) { p in
                        DisclosureGroup {
                            VStack(spacing: 8) {
                                ForEach(p.items) { i in
                                    HStack {
                                        Text(i.merchant.map(prettyMerchant) ?? "—").lineLimit(1)
                                        Spacer()
                                        Text(Money.format(i.share_amount, p.currency)).monospacedDigit()
                                    }
                                    .font(.system(size: 13, design: .rounded))
                                    .foregroundStyle(Palette.inkSoft)
                                }
                            }
                            .padding(.top, 8)
                        } label: {
                            HStack(spacing: 12) {
                                Text(initials(p.name))
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(Palette.mint)
                                    .frame(width: 38, height: 38)
                                    .background(Palette.mintSoft, in: .circle)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                    Text("\(p.items.count) unsettled").font(.caption).foregroundStyle(Palette.muted)
                                }
                                Spacer()
                                AmountText(amount: p.total, currency: p.currency, size: 16)
                            }
                        }
                        .tint(Palette.muted)
                        if let pid = p.person_id {
                            Button {
                                Task {
                                    try? await API(auth: auth).settle(personID: pid, currency: p.currency)
                                    changes.bump()
                                }
                            } label: {
                                Label("Mark \(p.name.split(separator: " ").first.map(String.init) ?? p.name) as paid", systemImage: "checkmark.circle")
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundStyle(Palette.mint)
                            }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
            } else {
                HStack(spacing: 12) {
                    Text("🤝").font(.system(size: 26))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("All square").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink)
                        Text("Nobody owes you a thing. Rare.").font(.caption).foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
    }

    private func initials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    // MARK: Subscriptions — set as a receipt strip

    @ViewBuilder private var subscriptions: some View {
        Card(title: "On repeat") {
            if subs.isEmpty {
                Text("No recurring charges detected.").foregroundStyle(Palette.inkSoft)
            } else {
                VStack(spacing: 0) {
                    ForEach(subs) { s in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(prettyMerchant(s.merchant)).font(.system(size: 15, weight: .semibold, design: .rounded))
                                    .foregroundStyle(Palette.ink).lineLimit(1)
                                Eyebrow("Every ~\(s.avg_gap_days)d · \(Theme.cardLabel(s.card))")
                            }
                            Spacer()
                            AmountText(amount: s.avg_amount, currency: s.currency, size: 16)
                        }
                        .padding(.vertical, 11)
                        if s.id != subs.last?.id { Perforation() }
                    }
                    Perforation(color: Palette.ink.opacity(0.35)).padding(.top, 4)
                    ForEach(totalsByCurrency, id: \.0) { ccy, total in
                        HStack {
                            Eyebrow("Per cycle · \(ccy)", color: Palette.ink)
                            Spacer()
                            AmountText(amount: total, currency: ccy, size: 18, weight: .bold)
                        }
                        .padding(.top, 10)
                    }
                }
            }
        }
    }

    private var totalsByCurrency: [(String, Double)] {
        Dictionary(grouping: subs, by: \.currency)
            .map { ($0.key, $0.value.reduce(0) { $0 + $1.avg_amount }) }
            .sorted { $0.0 > $1.0 }
    }
}
