import Charts
import SwiftUI
import WidgetKit

struct HomeView: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    @AppStorage("currencyMode") private var mode: CurrencyMode = .sgd
    @State private var period: Period = .this_month
    @State private var data: Overview?
    @State private var error: String?

    private var currency: String { mode.currency }
    private var summary: CurrencySummary? { data?.currencies[currency] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(eyebrow: Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)), title: "Overview") {
                        CurrencyPicker(mode: $mode)
                    }
                    PillPicker(options: Period.overview, selection: $period) { $0.short }

                    if let error, data == nil {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if let data, let s = summary {
                        hero(s, label: data.period.label)
                        if let cf = data.cash_flow?[currency] { cashFlow(cf) }
                        categories(s)
                        merchants(s)
                        largest(s)
                    } else if data != nil {
                        empty
                    } else {
                        ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, minHeight: 300)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { Feedback.play(.tap); await load() }
            .task(id: "\(period.rawValue)-\(mode.rawValue)-\(changes.version)") { await load() }
            .onChange(of: mode) { _, m in
                SharedStore.currencyMode = m.rawValue   // widgets follow the same currency view
                WidgetCenter.shared.reloadAllTimelines()
            }
            .navigationDestination(for: Txn.self) { TransactionDetailView(txn: $0) }
        }
    }

    private func load() async {
        let api = API(auth: auth)
        if let cached = api.cachedOverview(period, combine: mode.combine) { data = cached }
        do {
            let o = try await api.overview(period, combine: mode.combine)
            withAnimation(.snappy) { data = o }
            error = nil
            if !mode.isCombined, o.currencies[currency] == nil, o.currencies["INR"] != nil || o.currencies["SGD"] != nil {
                mode = o.currencies["SGD"] != nil ? .sgd : .inr
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Text("🧾").font(.system(size: 44))
            Text("Clean slate").font(.display(20)).foregroundStyle(Palette.ink)
            Text("No \(currency) spend in this period.").font(.subheadline).foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    // MARK: Hero ink card

    private func hero(_ s: CurrencySummary, label: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(mode.isCombined ? "Spent · \(label) · all cards" : "Spent · \(label)", color: Palette.mint.opacity(0.9))
            AmountText(amount: s.total, currency: currency, size: 46, weight: .bold, color: .white)
            Text(Quip.forChange(s.change_pct))
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.7))
            if let ex = data?.excluded?[currency], ex.total > 0 {
                Label("\(Money.format(ex.total, currency)) in Exclusions not counted", systemImage: "eye.slash")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
            }
            if let c = data?.combined, let rate = c.fx_rate {
                Label("SGD + INR combined at ₹\(rate.formatted(.number.precision(.fractionLength(2))))/S$ · \(c.fx_date ?? "")",
                      systemImage: "arrow.triangle.merge")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
            }

            Chart(s.daily) { p in
                BarMark(x: .value("Day", p.day, unit: .day), y: .value("Spend", p.total))
                    .foregroundStyle(Palette.mint.gradient)
                    .cornerRadius(3)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 64)
            .padding(.top, 4)

            Perforation(color: .white.opacity(0.18))

            HStack(spacing: 0) {
                stat("vs prior") {
                    if let pct = s.change_pct {
                        HStack(spacing: 3) {
                            Image(systemName: pct > 0 ? "arrow.up.right" : "arrow.down.right")
                                .font(.system(size: 11, weight: .heavy))
                            Text("\(abs(pct), specifier: "%.0f")%")
                        }
                        .foregroundStyle(pct > 0 ? Palette.coral : Palette.mint)
                    } else {
                        Text("—").foregroundStyle(.white.opacity(0.5))
                    }
                }
                stat("Txns") { Text("\(s.count)").foregroundStyle(.white) }
                stat("Per day") { Text(Money.format(s.avg_per_day, currency)).foregroundStyle(.white) }
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 22)
        .padding(.bottom, 30)
        .background {
            ReceiptEdge()
                .fill(LinearGradient(colors: [Palette.inkCardHighlight, Palette.inkCard], startPoint: .topTrailing, endPoint: .bottomLeading))
                .overlay(alignment: .topTrailing) {
                    // Finny's watermark: a faint oversized currency glyph.
                    Text(Money.symbol(currency))
                        .font(.display(150, .black))
                        .foregroundStyle(.white.opacity(0.025))
                        .offset(x: 18, y: -26)
                        .clipped()
                }
                .clipShape(ReceiptEdge())
        }
    }

    private func stat<V: View>(_ title: String, @ViewBuilder _ value: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(title, color: .white.opacity(0.45))
            value().font(.system(size: 16, weight: .bold, design: .rounded).monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Money in vs out

    private func cashFlow(_ cf: Overview.CashFlow) -> some View {
        Card(title: "Money in vs out") {
            HStack(alignment: .top, spacing: 12) {
                flowStat("In", cf.in_total, Palette.mint, prefix: "+")
                flowStat("Out · your share", cf.out_total, Palette.ink, prefix: "−")
            }
            if cf.in_total > 0 {
                HStack(alignment: .firstTextBaseline) {
                    Eyebrow(cf.net >= 0 ? "Net saved" : "Net overspent")
                    Spacer()
                    Text((cf.net >= 0 ? "+" : "−") + Money.format(abs(cf.net), currency))
                        .font(.system(size: 20, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(cf.net >= 0 ? Palette.mint : Palette.coral)
                }
                GeometryReader { g in
                    let outShare = min(1, cf.out_total / max(cf.in_total, 1))
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.mintSoft)
                        Capsule().fill(outShare >= 1 ? Palette.coral : Palette.ink).frame(width: g.size.width * outShare)
                    }
                }
                .frame(height: 8)
                Text(cf.net >= 0
                     ? "Kept \(Int((cf.net / cf.in_total * 100).rounded()))% of what came in."
                     : "Spent more than came in this period.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Palette.inkSoft)
                HStack(spacing: 8) {
                    ForEach(cf.in_by_kind.sorted { $0.value > $1.value }, id: \.key) { k, v in
                        Text("\(IncomingKind(rawValue: k)?.label ?? k) \(Money.format(v, currency, compact: true))")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Palette.mint)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Palette.mintSoft, in: .capsule)
                    }
                }
            } else {
                Text("No money in recorded for this period yet. Salary and transfers appear as their bank alerts arrive.")
                    .font(.caption).foregroundStyle(Palette.muted)
            }
        }
    }

    private func flowStat(_ title: String, _ value: Double, _ color: Color, prefix: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(title)
            Text(prefix + Money.format(value, currency))
                .font(.system(size: 20, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Categories

    private func categories(_ s: CurrencySummary) -> some View {
        Card(title: "Where it went") {
            // One stacked bar of the whole period, coloured by category.
            GeometryReader { g in
                HStack(spacing: 3) {
                    ForEach(s.by_category) { c in
                        Theme.chip(forCategory: c.key).fg
                            .frame(width: max(4, (g.size.width - CGFloat(s.by_category.count - 1) * 3) * c.total / max(s.total, 1)))
                    }
                }
                .clipShape(.capsule)
            }
            .frame(height: 10)

            VStack(spacing: 0) {
                ForEach(Array(s.by_category.enumerated()), id: \.element.id) { i, c in
                    NavigationLink {
                        FilteredTransactionsView(title: c.key, currency: mode.isCombined ? nil : currency, category: c.key, period: data?.period)
                    } label: {
                        HStack(spacing: 12) {
                            CategoryIcon(category: c.key, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.key).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                Text("\(Int((c.total / max(s.total, 1) * 100).rounded()))% of spend")
                                    .font(.caption).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            AmountText(amount: c.total, currency: currency, size: 16)
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.muted)
                        }
                        .padding(.vertical, 10)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    if i < s.by_category.count - 1 { Perforation().padding(.leading, 48) }
                }
            }
        }
    }

    // MARK: Merchants

    private func merchants(_ s: CurrencySummary) -> some View {
        Card(title: "Usual suspects") {
            VStack(spacing: 12) {
                ForEach(Array(s.top_merchants.prefix(6).enumerated()), id: \.element.id) { i, m in
                    HStack(spacing: 12) {
                        Text(String(format: "%02d", i + 1))
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(i == 0 ? Palette.mint : Palette.muted)
                            .frame(width: 22, alignment: .leading)
                        Text(prettyMerchant(m.key)).font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(Palette.ink).lineLimit(1)
                        Spacer()
                        AmountText(amount: m.total, currency: currency, size: 15, weight: .semibold)
                    }
                }
            }
        }
    }

    // MARK: Largest

    private func largest(_ s: CurrencySummary) -> some View {
        Card(title: "Big tickets") {
            VStack(spacing: 0) {
                ForEach(s.largest) { t in
                    NavigationLink(value: t) { TransactionRow(txn: t) }.buttonStyle(.plain)
                    if t.id != s.largest.last?.id { Perforation().padding(.leading, 52) }
                }
            }
        }
    }
}
