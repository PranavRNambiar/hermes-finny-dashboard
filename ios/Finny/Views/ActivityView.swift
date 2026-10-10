import SwiftUI

/// Paged transaction list with search and filters.
@MainActor
@Observable
final class TxnFeed {
    var items: [Txn] = []
    var total = 0
    var loading = false
    var error: String?

    var query = ""
    var currency: String?
    var card: String?
    var category: String?
    var from: String?
    var to: String?

    private var generation = 0

    func reload(_ api: API) async {
        generation += 1
        items = []
        total = 0
        await loadMore(api)
    }

    func loadMore(_ api: API) async {
        guard !loading, items.isEmpty || items.count < total else { return }
        let gen = generation
        loading = true
        defer { loading = false }
        do {
            let page = try await api.transactions(query: query, currency: currency, card: card, category: category,
                                                  from: from, to: to, offset: items.count, limit: 50)
            guard gen == generation else { return }
            items += page.transactions
            total = page.total
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    var grouped: [(day: String, txns: [Txn])] {
        Dictionary(grouping: items, by: \.txn_date)
            .sorted { $0.key > $1.key }
            .map { ($0.key, $0.value) }
    }
}

struct ActivityView: View {
    @Environment(Auth.self) private var auth
    @State private var feed = TxnFeed()
    @State private var meta: Meta?
    @State private var showFilters = false
    @FocusState private var searching: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(eyebrow: "\(feed.total) transactions", title: "Activity")
                    searchField
                    filterChips
                    TxnSections(feed: feed)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.immediately)
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await feed.reload(API(auth: auth)) }
            .navigationDestination(for: Txn.self) { TransactionDetailView(txn: $0) }
            .sheet(isPresented: $showFilters) {
                FilterSheet(feed: feed, meta: meta) { reload() }
                    .presentationDetents([.medium, .large])
            }
            .task {
                if feed.items.isEmpty { await feed.reload(API(auth: auth)) }
                if meta == nil { meta = try? await API(auth: auth).meta() }
            }
        }
    }

    private func reload() { Task { await feed.reload(API(auth: auth)) } }

    private var searchField: some View {
        @Bindable var feed = feed
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
            TextField("Try “Grab” or “Koufu”", text: $feed.query)
                .font(.system(size: 16, weight: .medium, design: .rounded))
                .foregroundStyle(Palette.ink)
                .focused($searching)
                .submitLabel(.search)
                .onSubmit(reload)
                .autocorrectionDisabled()
            if !feed.query.isEmpty {
                Button { feed.query = ""; reload() } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted)
                }
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(Palette.surface, in: .rect(cornerRadius: 16, style: .continuous))
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", on: feed.currency == nil) { feed.currency = nil; reload() }
                chip("SGD", on: feed.currency == "SGD") { feed.currency = "SGD"; reload() }
                chip("INR", on: feed.currency == "INR") { feed.currency = "INR"; reload() }
                if let c = feed.card {
                    chip(Theme.cardLabel(c), on: true, removable: true) { feed.card = nil; reload() }
                }
                if let c = feed.category {
                    chip(c, on: true, removable: true) { feed.category = nil; reload() }
                }
                Button { showFilters = true } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "slider.horizontal.3")
                        Text("FILTER").tracking(0.8)
                    }
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .overlay(Capsule().strokeBorder(Palette.hairline, lineWidth: 1.2))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func chip(_ text: String, on: Bool, removable: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(text.uppercased()).tracking(0.8)
                if removable { Image(systemName: "xmark").font(.system(size: 8, weight: .heavy)) }
            }
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(on ? Palette.surface : Palette.inkSoft)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(on ? Palette.ink : Palette.surface, in: .capsule)
        }
        .buttonStyle(.plain)
    }
}

/// Transactions for one category within a period; opened from Overview.
struct FilteredTransactionsView: View {
    @Environment(Auth.self) private var auth
    let title: String
    let currency: String
    let category: String
    let period: Overview.PeriodInfo?
    @State private var feed = TxnFeed()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    CategoryIcon(category: category, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Eyebrow(period?.label ?? "")
                        Text(title).font(.display(26)).tracking(-0.5).foregroundStyle(Palette.ink)
                    }
                }
                TxnSections(feed: feed)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .canvasBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task {
            feed.currency = currency
            feed.category = category
            feed.from = period?.from
            feed.to = period?.to
            await feed.reload(API(auth: auth))
        }
    }
}

/// Day-grouped cards of transactions with infinite scroll.
struct TxnSections: View {
    @Environment(Auth.self) private var auth
    let feed: TxnFeed

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 18) {
            ForEach(feed.grouped, id: \.day) { group in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Eyebrow(dayLabel(group.day))
                        Spacer()
                        Text(dayTotals(group.txns))
                            .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .padding(.horizontal, 4)
                    VStack(spacing: 0) {
                        ForEach(group.txns) { t in
                            NavigationLink(value: t) { TransactionRow(txn: t) }
                                .buttonStyle(.plain)
                                .onAppear { if t.id == feed.items.last?.id { Task { await feed.loadMore(API(auth: auth)) } } }
                            if t.id != group.txns.last?.id { Perforation().padding(.leading, 52) }
                        }
                    }
                    .card(padding: 14)
                }
            }
            if feed.loading {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding()
            } else if let e = feed.error, feed.items.isEmpty {
                ErrorBanner(message: e) { Task { await feed.reload(API(auth: auth)) } }
            } else if feed.items.isEmpty {
                VStack(spacing: 8) {
                    Text("🔍").font(.system(size: 40))
                    Text("Nothing here").font(.display(18)).foregroundStyle(Palette.ink)
                    Text("Either you were good, or the bank was slow.").font(.subheadline).foregroundStyle(Palette.inkSoft)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            }
        }
    }

    private func dayLabel(_ iso: String) -> String {
        guard let d = DateFormatter.isoDay.date(from: iso) else { return iso }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    private func dayTotals(_ txns: [Txn]) -> String {
        Dictionary(grouping: txns, by: \.currency)
            .sorted { $0.key > $1.key }
            .map { Money.format($0.value.reduce(0) { $0 + $1.amount }, $0.key) }
            .joined(separator: "  ·  ")
    }
}

struct TransactionRow: View {
    let txn: Txn
    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(category: txn.category)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(txn.displayMerchant)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                    if txn.anomaly_flagged {
                        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.coral)
                    }
                }
                Text(subtitle).font(.system(size: 12, design: .rounded)).foregroundStyle(Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                AmountText(amount: txn.amount, currency: txn.currency, size: 16)
                if let tag = txn.user_tag {
                    Text("#\(tag)").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Palette.mint)
                }
            }
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
    }

    /// "Today, 12:36 · DBS" in the Fold-ish timestamp style.
    private var subtitle: String {
        let cal = Calendar.current
        let day = cal.isDateInToday(txn.date) ? "Today" : cal.isDateInYesterday(txn.date) ? "Yesterday"
            : txn.date.formatted(.dateTime.day().month(.abbreviated))
        let time = txn.txn_time.map { ", " + String($0.prefix(5)) } ?? ""
        return "\(day)\(time) · \(Theme.cardLabel(txn.card))"
    }
}

struct FilterSheet: View {
    let feed: TxnFeed
    let meta: Meta?
    let apply: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var feed = feed
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    section("Card") {
                        FlowChips(items: meta?.cards.map(\.card) ?? [], label: Theme.cardLabel, selection: $feed.card)
                    }
                    section("Category") {
                        FlowChips(items: meta?.categories.map(\.name) ?? [], label: { $0 }, selection: $feed.category)
                    }
                    Button("Show results") { apply(); dismiss() }.buttonStyle(InkButtonStyle())
                    Button("Clear all") { feed.card = nil; feed.category = nil; feed.currency = nil }
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(Palette.inkSoft)
                        .frame(maxWidth: .infinity)
                }
                .padding(20)
            }
            .canvasBackground()
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { Eyebrow(title); c() }
    }
}

/// Wrapping single-select chips.
struct FlowChips: View {
    let items: [String]
    let label: (String) -> String
    @Binding var selection: String?

    var body: some View {
        WrapLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                let on = selection == item
                Button { selection = on ? nil : item } label: {
                    Text(label(item).uppercased())
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .tracking(0.8)
                        .foregroundStyle(on ? Palette.surface : Palette.inkSoft)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(on ? Palette.ink : Palette.surface, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct WrapLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > width, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += sz.width + spacing
            row = max(row, sz.height)
        }
        return CGSize(width: width == .infinity ? x : width, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += sz.width + spacing
            row = max(row, sz.height)
        }
    }
}
