import SwiftUI

/// Paged transaction list with search and filters.
@MainActor
@Observable
final class TxnFeed {
    var items: [Txn] = []
    var total = 0
    var interpreted: String?
    var totals: [String: Double] = [:]
    var loading = false
    var error: String?

    var query = ""
    var currency: String?
    var card: String?
    var category: String?
    var from: String?
    var to: String?

    private var generation = 0

    /// First page again. Shows the last copy of it straight away, then swaps in the fresh one.
    func reload(_ api: API) async {
        generation += 1
        let gen = generation
        let q = query.trimmingCharacters(in: .whitespaces)
        if let cached = api.cachedTransactions(query: q, currency: currency, card: card, category: category, from: from, to: to) {
            apply(cached, replace: true)
        } else {
            items = []; total = 0; interpreted = nil; totals = [:]
        }
        loading = true
        defer { if gen == generation { loading = false } }
        do {
            let page = try await api.transactions(query: q, currency: currency, card: card, category: category,
                                                  from: from, to: to, offset: 0, limit: 50)
            guard gen == generation else { return }
            apply(page, replace: true)
            error = nil
        } catch {
            if gen == generation, !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }

    func loadMore(_ api: API) async {
        guard !loading, items.count < total else { return }
        let gen = generation
        loading = true
        defer { loading = false }
        do {
            let page = try await api.transactions(query: query.trimmingCharacters(in: .whitespaces), currency: currency, card: card,
                                                  category: category, from: from, to: to, offset: items.count, limit: 50)
            guard gen == generation else { return }
            apply(page, replace: false)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ page: TxnPage, replace: Bool) {
        items = replace ? page.transactions : items + page.transactions
        total = page.total
        if replace { interpreted = page.interpreted; totals = page.totals ?? [:] }
    }

    var grouped: [(day: String, txns: [Txn])] {
        Dictionary(grouping: items, by: \.txn_date)
            .sorted { $0.key > $1.key }
            .map { ($0.key, $0.value) }
    }
}

struct ActivityView: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    @State private var feed = TxnFeed()
    @State private var meta: Meta?
    @State private var showFilters = false
    @State private var side = "Spent"
    @FocusState private var searching: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(eyebrow: side == "Spent" ? "\(feed.total) transactions" : "Money in", title: "Activity")
                    PillPicker(options: ["Spent", "Received"], selection: $side) { $0 }
                    if side == "Spent" {
                        searchField
                        filterChips
                        if !feed.query.isEmpty, let what = feed.interpreted { searchSummary(what) }
                        TxnSections(feed: feed)
                    } else {
                        IncomingSection()
                    }
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
            .task(id: changes.version) {
                let api = API(auth: auth)
                meta = api.cachedMeta()
                await feed.reload(api)
                meta = (try? await api.meta()) ?? meta
            }
            .onChange(of: feed.query) { _, _ in
                // Search as you type, once typing pauses.
                typing?.cancel()
                typing = Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    if !Task.isCancelled { await feed.reload(API(auth: auth)) }
                }
            }
        }
    }

    @State private var typing: Task<Void, Never>?

    private func reload() { typing?.cancel(); Task { await feed.reload(API(auth: auth)) } }

    /// How the search was understood, plus what it adds up to.
    private func searchSummary(_ what: String) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Showing")
                Text(what).font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink)
                Text("\(feed.total) transaction\(feed.total == 1 ? "" : "s")").font(.caption).foregroundStyle(Palette.muted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                ForEach(feed.totals.sorted(by: { $0.key > $1.key }), id: \.key) { c, v in
                    AmountText(amount: v, currency: c, size: 20, weight: .bold)
                }
            }
        }
        .card(padding: 16)
    }

    private var searchField: some View {
        @Bindable var feed = feed
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
            TextField("Try “august”, “grab last month”, “food >20”", text: $feed.query)
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
    @Environment(DataChanges.self) private var changes
    let title: String
    let currency: String?
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
        .task(id: changes.version) {
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
                                .simultaneousGesture(TapGesture().onEnded { Feedback.play(.tap) })
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
                if txn.isSplit {
                    Label("your share of \(Money.format(txn.fullAmount, txn.currency))", systemImage: "person.2.fill")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(Palette.mint)
                }
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

// MARK: - Money in

struct IncomingSection: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    @State private var period: Period = .this_month
    @State private var items: [Incoming] = []
    @State private var loading = true
    @State private var editing: Incoming?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PillPicker(options: Period.overview, selection: $period) { $0.short }
            if loading {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(.vertical, 40)
            } else if items.isEmpty {
                VStack(spacing: 8) {
                    Text("💸").font(.system(size: 40))
                    Text("Nothing came in").font(.display(18)).foregroundStyle(Palette.ink)
                    Text("Salary, PayNow received, refunds and top-ups appear here as their alerts arrive.")
                        .font(.subheadline).foregroundStyle(Palette.inkSoft).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                totals
                VStack(spacing: 0) {
                    ForEach(items) { i in
                        Button { editing = i } label: { IncomingRow(item: i) }.buttonStyle(.plain)
                        if i.id != items.last?.id { Perforation().padding(.leading, 52) }
                    }
                }
                .card(padding: 14)
            }
        }
        .task(id: "\(period.rawValue)-\(changes.version)") {
            let api = API(auth: auth)
            if let cached = api.cachedIncoming(period: period) { items = cached }
            loading = api.cachedIncoming(period: period) == nil
            items = (try? await api.incoming(period: period)) ?? items
            loading = false
        }
        .sheet(item: $editing) { i in IncomingKindSheet(item: i) }
    }

    private var totals: some View {
        let income = items.filter { $0.kind != "own_transfer" }
        let byCcy = Dictionary(grouping: income, by: \.currency).mapValues { $0.reduce(0) { $0 + $1.amount } }
        return HStack(spacing: 12) {
            ForEach(byCcy.keys.sorted(), id: \.self) { c in
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow("Received · \(c)")
                    AmountText(amount: byCcy[c] ?? 0, currency: c, size: 26, weight: .bold, color: Palette.mint)
                }
                .card(padding: 14)
            }
        }
    }
}

struct IncomingRow: View {
    let item: Incoming
    var body: some View {
        let kind = IncomingKind(rawValue: item.kind) ?? .transfer
        HStack(spacing: 12) {
            Image(systemName: kind.symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Palette.mint)
                .frame(width: 40, height: 40)
                .background(Palette.mintSoft, in: .rect(cornerRadius: 13, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink).lineLimit(1)
                Text("\(kind.label) · \(item.date.formatted(.dateTime.day().month(.abbreviated))) · \(Theme.cardLabel(item.card))")
                    .font(.system(size: 12, design: .rounded)).foregroundStyle(Palette.muted)
            }
            Spacer()
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text("+").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(kind == .own_transfer ? Palette.muted : Palette.mint)
                AmountText(amount: item.amount, currency: item.currency, size: 16, color: kind == .own_transfer ? Palette.muted : Palette.mint)
            }
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
    }
}

private struct IncomingKindSheet: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    @Environment(\.dismiss) private var dismiss
    let item: Incoming
    @State private var kind: IncomingKind = .transfer
    @State private var always = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Eyebrow("From \(item.name)")
                        AmountText(amount: item.amount, currency: item.currency, size: 36, weight: .bold, color: Palette.mint)
                    }
                    VStack(spacing: 0) {
                        ForEach(IncomingKind.allCases) { k in
                            Button { kind = k } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: k.symbol).foregroundStyle(Palette.mint).frame(width: 28)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(k.label).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                        if k == .own_transfer {
                                            Text("Moving your own money, not counted as income").font(.caption).foregroundStyle(Palette.muted)
                                        }
                                    }
                                    Spacer()
                                    if kind == k { Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.mint).font(.system(size: 20)) }
                                }
                                .padding(.vertical, 10).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            if k != IncomingKind.allCases.last { Perforation().padding(.leading, 40) }
                        }
                    }
                    .card(padding: 14)
                    Toggle(isOn: $always) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Always for \(item.name)").font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                            Text("Past and future money from them").font(.caption).foregroundStyle(Palette.muted)
                        }
                    }
                    .tint(Palette.mint)
                    .card(padding: 16)
                    if let error { Text(error).font(.footnote).foregroundStyle(Palette.coral) }
                    Button("Save") { save() }.buttonStyle(InkButtonStyle())
                }
                .padding(20)
            }
            .canvasBackground()
            .navigationTitle("What was this?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.fontWeight(.bold) }
            }
        }
        .presentationDetents([.large])
        .onAppear { kind = IncomingKind(rawValue: item.kind) ?? .transfer }
    }

    private func save() {
        Task {
            do {
                try await API(auth: auth).setIncomingKind(id: item.id, kind: kind.rawValue, applyToSender: always)
                changes.bump()
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
