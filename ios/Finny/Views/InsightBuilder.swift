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
    @State private var data: [String: Breakdown] = [:]

    private var currency: String { mode.currency }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow(spec.title)
                    AmountText(amount: data[currency]?.total ?? 0, currency: currency, size: 26, weight: .bold)
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
            InsightChartView(spec: spec, data: data[currency], currency: currency)
                .frame(height: spec.chart == .pie ? 150 : 170)
        }
        .card()
        .task(id: "\(spec.hashValue)-\(mode.rawValue)-\(changes.version)") {
            data = (try? await API(auth: auth).breakdown(spec, combine: mode.combine)) ?? [:]
        }
    }
}

/// Build (or edit) an insight: what, when, which chart. Live preview as you go.
struct InsightBuilderSheet: View {
    @Environment(Auth.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State var spec: InsightSpec
    let mode: CurrencyMode
    let onSave: (InsightSpec) -> Void

    @State private var merchants: [MerchantInfo] = []
    @State private var tags: [String] = []
    @State private var search = ""
    @State private var preview: [String: Breakdown] = [:]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Preview
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(spec.title)
                        AmountText(amount: preview[mode.currency]?.total ?? 0, currency: mode.currency, size: 28, weight: .bold)
                        InsightChartView(spec: spec, data: preview[mode.currency], currency: mode.currency)
                            .frame(height: 170)
                    }
                    .card()

                    section("Chart") {
                        PillPicker(options: InsightSpec.Chart.allCases, selection: $spec.chart) {
                            switch $0 { case .bar: "Bars"; case .line: "Line"; case .pie: "Pie" }
                        }
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

                    section("Show") {
                        PillPicker(options: InsightSpec.Scope.allCases, selection: $spec.scope) {
                            switch $0 { case .all: "All"; case .merchant: "Merchant"; case .category: "Category"; case .tag: "Tag" }
                        }
                        valuePicker
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
                        .disabled(spec.scope != .all && spec.value.isEmpty)
                }
            }
            .task {
                async let m = try? API(auth: auth).merchants()
                async let t = try? API(auth: auth).meta()
                merchants = await m ?? []
                tags = (await t)?.tags.map(\.name) ?? []
            }
            .onChange(of: spec.scope) { _, _ in spec.value = "" }
            .task(id: spec) {
                if spec.scope != .all && spec.value.isEmpty { preview = [:]; return }
                try? await Task.sleep(for: .milliseconds(250))   // debounce while tapping around
                preview = (try? await API(auth: auth).breakdown(spec, combine: mode.combine)) ?? preview
            }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private var valuePicker: some View {
        switch spec.scope {
        case .all:
            EmptyView()
        case .category:
            WrapLayout(spacing: 8) {
                ForEach(allCategories, id: \.self) { c in chip(c, on: spec.value == c) { spec.value = c } }
            }
        case .tag:
            if tags.isEmpty {
                Text("No tags yet.").font(.caption).foregroundStyle(Palette.muted)
            } else {
                WrapLayout(spacing: 8) {
                    ForEach(tags.prefix(30), id: \.self) { t in chip("#\(t)", on: spec.value == t) { spec.value = t } }
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
                        Button { spec.value = m.name } label: {
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
                                if spec.value == m.name { Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.mint).font(.system(size: 20)) }
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
