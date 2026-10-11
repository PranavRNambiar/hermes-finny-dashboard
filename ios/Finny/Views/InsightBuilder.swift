import SwiftUI
import WidgetKit

/// Saved insights live in the App Group so widgets can show them too.
@MainActor
@Observable
final class InsightsStore {
    private(set) var all: [InsightSpec] = SharedStore.insights
    var pinned: [InsightSpec] { all.filter(\.pinned) }
    var saved: [InsightSpec] { all.filter { !$0.pinned } }

    func save(_ spec: InsightSpec) {
        if let i = all.firstIndex(where: { $0.id == spec.id }) { all[i] = spec } else { all.insert(spec, at: 0) }
        persist()
    }

    func delete(_ spec: InsightSpec) {
        all.removeAll { $0.id == spec.id }
        persist()
    }

    func togglePin(_ spec: InsightSpec) {
        var s = spec
        s.pinned.toggle()
        save(s)
    }

    private func persist() {
        SharedStore.insights = all
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// One pinned insight on the Insights tab.
struct InsightCard: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    let spec: InsightSpec
    let mode: CurrencyMode
    var onEdit: () -> Void = {}
    var onUnpin: () -> Void = {}
    var onDelete: () -> Void = {}
    @State private var data: InsightData?

    private var currency: String { mode.currency }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow(spec.title)
                    InsightTotals(spec: spec, data: data, currency: currency)
                }
                Spacer()
                Menu {
                    Button("Edit", systemImage: "slider.horizontal.3", action: onEdit)
                    Button(spec.pinned ? "Unpin" : "Pin to Insights", systemImage: spec.pinned ? "pin.slash" : "pin", action: onUnpin)
                    Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.muted)
                        .frame(width: 32, height: 32).contentShape(.rect)
                }
            }
            InsightChartView(spec: spec, data: data, currency: currency)
                .frame(height: chartHeight(spec))
        }
        .card()
        .task(id: "\(spec.hashValue)-\(mode.rawValue)-\(changes.version)") {
            let api = API(auth: auth)
            if let cached = api.cachedInsight(spec, combine: mode.combine) { data = cached }
            if let fresh = try? await api.insight(spec, combine: mode.combine) { data = fresh }
        }
    }
}

func chartHeight(_ spec: InsightSpec) -> CGFloat {
    switch spec.chart {
    case .pie: 150
    case .totals: CGFloat(max(1, spec.series.count)) * 40 + 10
    default: spec.series.count > 1 ? 200 : 170
    }
}

/// Build (or edit) an insight: compare any mix of categories, merchants and tags, over a range,
/// as bars, stacked bars, lines, totals or a pie. Live preview as you go.
struct InsightBuilderSheet: View {
    @Environment(Auth.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State var spec: InsightSpec
    let mode: CurrencyMode
    let onSave: (InsightSpec) -> Void

    @State private var merchants: [MerchantInfo] = []
    @State private var tags: [String] = []
    @State private var search = ""
    @State private var adding: InsightSpec.Kind = .category
    @State private var preview: InsightData?

    private static let presets: [(String, [InsightSpec.Series])] = [
        ("Food vs Fitness", [.init(kind: .category, value: "Food & Drink"), .init(kind: .category, value: "Health & Fitness")]),
        ("Food vs Transport vs Shopping", [.init(kind: .category, value: "Food & Drink"), .init(kind: .category, value: "Transport"), .init(kind: .category, value: "Shopping")]),
        ("Everything vs Food", [.init(kind: .all), .init(kind: .category, value: "Food & Drink")]),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Preview
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(spec.title)
                        InsightTotals(spec: spec, data: preview, currency: mode.currency, size: 28)
                        InsightChartView(spec: spec, data: preview, currency: mode.currency)
                            .frame(height: chartHeight(spec))
                    }
                    .card()

                    section("Comparing") {
                        WrapLayout(spacing: 8) {
                            ForEach(Array(spec.series.enumerated()), id: \.element) { i, s in
                                Button { toggle(s) } label: {
                                    HStack(spacing: 6) {
                                        Circle().fill(InsightChartView.color(i)).frame(width: 9, height: 9)
                                        Text(s.label).lineLimit(1)
                                        Image(systemName: "xmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Palette.muted)
                                    }
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(Palette.ink)
                                    .padding(.horizontal, 12).frame(height: 32)
                                    .background(Palette.surface, in: .capsule)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        if spec.series.isEmpty {
                            Text("Add at least one thing below.").font(.caption).foregroundStyle(Palette.muted)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(Self.presets, id: \.0) { name, series in
                                    Button { Feedback.play(.select); spec.series = series } label: {
                                        Text(name).font(.system(size: 12, weight: .bold, design: .rounded))
                                            .foregroundStyle(Palette.mint)
                                            .padding(.horizontal, 12).frame(height: 30)
                                            .background(Palette.mint.opacity(0.14), in: .capsule)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    section("Add to chart") {
                        PillPicker(options: [InsightSpec.Kind.category, .merchant, .tag, .all], selection: $adding) {
                            switch $0 { case .all: "All"; case .merchant: "Merchant"; case .category: "Category"; case .tag: "Tag" }
                        }
                        valuePicker
                    }

                    section("Range") {
                        WrapLayout(spacing: 8) {
                            ForEach(InsightSpec.Range.allCases, id: \.self) { r in
                                chip(r.label, on: spec.range == r) {
                                    spec.range = r
                                    if r == .custom, spec.from == nil {
                                        spec.from = Calendar.current.date(byAdding: .month, value: -3, to: .now)
                                        spec.to = .now
                                    }
                                }
                            }
                        }
                        if spec.range == .custom {
                            VStack(spacing: 0) {
                                DatePicker("From", selection: Binding(get: { spec.from ?? .now }, set: { spec.from = $0 }), in: ...(spec.to ?? .now), displayedComponents: .date)
                                Perforation().padding(.vertical, 8)
                                DatePicker("To", selection: Binding(get: { spec.to ?? .now }, set: { spec.to = $0 }), in: (spec.from ?? .distantPast)..., displayedComponents: .date)
                            }
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .tint(Palette.mint)
                            .card(padding: 14)
                        }
                    }

                    section("Chart") {
                        WrapLayout(spacing: 8) {
                            ForEach(InsightSpec.Chart.allCases, id: \.self) { c in chip(c.label, on: spec.chart == c) { spec.chart = c } }
                        }
                        Text(spec.chart.hint + (spec.range == .today && spec.chart != .totals && spec.chart != .pie ? " — for Today, Totals or Pie read best." : ""))
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                .padding(20)
            }
            .canvasBackground()
            .navigationTitle("Insight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(spec); dismiss() }
                        .fontWeight(.bold)
                        .disabled(!spec.isReady)
                }
            }
            .task {
                let api = API(auth: auth)
                merchants = (try? await api.merchants()) ?? []
                var meta = api.cachedMeta()
                if meta == nil { meta = try? await api.meta() }
                tags = meta?.tags.map(\.name) ?? []
            }
            .task(id: spec) {
                guard spec.isReady else { preview = nil; return }
                let api = API(auth: auth)
                if let cached = api.cachedInsight(spec, combine: mode.combine) { preview = cached; return }
                try? await Task.sleep(for: .milliseconds(200))   // debounce while tapping around
                if let fresh = try? await api.insight(spec, combine: mode.combine) { preview = fresh }
            }
        }
        .presentationDetents([.large])
    }

    private func has(_ s: InsightSpec.Series) -> Bool { spec.series.contains(s) }

    private func toggle(_ s: InsightSpec.Series) {
        Feedback.play(.select)
        if has(s) { spec.series.removeAll { $0 == s }; return }
        // "All spending" on its own replaces nothing; anything else drops a lone "All" placeholder.
        if s.kind != .all, spec.series == [InsightSpec.Series(kind: .all)] { spec.series = [] }
        if spec.series.count < 8 { spec.series.append(s) }
    }

    @ViewBuilder private var valuePicker: some View {
        switch adding {
        case .all:
            WrapLayout(spacing: 8) { chip("All spending", on: has(.init(kind: .all))) { toggle(.init(kind: .all)) } }
        case .category:
            WrapLayout(spacing: 8) {
                ForEach(allCategories, id: \.self) { c in chip(c, on: has(.init(kind: .category, value: c))) { toggle(.init(kind: .category, value: c)) } }
            }
        case .tag:
            if tags.isEmpty {
                Text("No tags yet.").font(.caption).foregroundStyle(Palette.muted)
            } else {
                WrapLayout(spacing: 8) {
                    ForEach(tags.prefix(30), id: \.self) { t in chip("#\(t)", on: has(.init(kind: .tag, value: t))) { toggle(.init(kind: .tag, value: t)) } }
                }
            }
        case .merchant:
            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
                    TextField("Search merchants (your names too)", text: $search)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 14).frame(height: 44)
                .background(Palette.surface, in: .rect(cornerRadius: 14, style: .continuous))
                VStack(spacing: 0) {
                    let list = merchants.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }.prefix(25)
                    ForEach(Array(list)) { m in
                        let s = InsightSpec.Series(kind: .merchant, value: m.name)
                        Button { toggle(s) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    HStack(spacing: 4) {
                                        Text(m.renamed ? m.name : prettyMerchant(m.name))
                                            .font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink).lineLimit(1)
                                        if m.renamed { Image(systemName: "pencil").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.mint) }
                                    }
                                    Text("\(m.count) visits · last \(m.last)").font(.caption).foregroundStyle(Palette.muted)
                                }
                                Spacer()
                                if has(s) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.mint).font(.system(size: 20)) }
                            }
                            .padding(.vertical, 8).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .card(padding: 14)
            }
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { Eyebrow(title); c() }
    }

    private func chip(_ text: String, on: Bool, _ tap: @escaping () -> Void) -> some View {
        Button {
            if !on { Feedback.play(.select) }
            tap()
        } label: {
            Text(text)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(on ? Palette.surface : Palette.inkSoft)
                .padding(.horizontal, 12).frame(height: 32)
                .background(on ? Palette.ink : Palette.surface, in: .capsule)
        }
        .buttonStyle(.plain)
    }
}
