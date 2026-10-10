import Charts
import SwiftUI

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
                    PillPicker(options: Period.allCases, selection: $period) { $0.short }

                    if let error, data == nil {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if let data, let s = summary {
                        hero(s, label: data.period.label)
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
            .refreshable { await load() }
            .task(id: "\(period.rawValue)-\(mode.rawValue)-\(changes.version)") { await load() }
            .navigationDestination(for: Txn.self) { TransactionDetailView(txn: $0) }
        }
    }

    private func load() async {
        do {
            let o = try await API(auth: auth).overview(period, combine: mode.combine)
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
