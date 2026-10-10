import SwiftUI

/// Transaction detail laid out as a receipt, with tag / category / rename editing.
struct TransactionDetailView: View {
    @Environment(Auth.self) private var auth
    @Environment(DataChanges.self) private var changes
    let txn: Txn
    @State private var full: Txn?
    @State private var sheet: EditSheet?
    @State private var toast: String?

    enum EditSheet: String, Identifiable {
        case tag, category, rename
        var id: String { rawValue }
    }

    var body: some View {
        let t = full ?? txn
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 14) {
                    CategoryIcon(category: t.category, size: 64)
                    Button { sheet = .rename } label: {
                        HStack(spacing: 6) {
                            Text(t.displayMerchant)
                                .font(.display(22, .semibold))
                                .foregroundStyle(Palette.ink)
                                .multilineTextAlignment(.center)
                            Image(systemName: "pencil").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.muted)
                        }
                    }
                    .buttonStyle(.plain)
                    if t.isRenamed, let raw = t.raw_merchant {
                        Text("Bank name: \(raw)").font(.system(size: 11, design: .monospaced)).foregroundStyle(Palette.muted)
                    }
                    AmountText(amount: t.amount, currency: t.currency, size: 48, weight: .bold)
                    Button { sheet = .category } label: {
                        HStack(spacing: 4) {
                            CategoryTag(category: t.category)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .heavy)).foregroundStyle(Palette.muted)
                        }
                    }
                    .buttonStyle(.plain)
                    if t.anomaly_flagged {
                        Label("Unusual for you", systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(Palette.coral)
                    }

                    Perforation().padding(.vertical, 6)

                    VStack(spacing: 14) {
                        row("Date", t.date.formatted(.dateTime.weekday(.wide).day().month(.wide).year()))
                        if let time = t.txn_time { row("Time", String(time.prefix(5))) }
                        row("Card", Theme.cardLabel(t.card))
                        HStack {
                            Eyebrow("Tag")
                            Spacer()
                            Button { sheet = .tag } label: {
                                Text(t.user_tag.map { "#\($0)" } ?? "+ Add tag")
                                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                                    .foregroundStyle(Palette.mint)
                            }
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 28)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
                .background(ReceiptEdge(radius: 28).fill(Palette.surface))

                HStack(spacing: 10) {
                    action("Tag", "number") { sheet = .tag }
                    action("Category", "square.grid.2x2") { sheet = .category }
                    action("Rename", "character.cursor.ibeam") { sheet = .rename }
                }

                if let splits = t.splits, !splits.isEmpty {
                    Card(title: "Split with") {
                        ForEach(splits, id: \.self) { s in
                            HStack {
                                Text(s.person ?? "—").font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                Spacer()
                                AmountText(amount: s.share_amount, currency: s.currency, size: 15)
                                Image(systemName: s.status == "settled" ? "checkmark.circle.fill" : "clock.fill")
                                    .foregroundStyle(s.status == "settled" ? Palette.mint : Palette.coral)
                            }
                        }
                    }
                }
                if let raw = t.raw_desc, !raw.isEmpty {
                    Card(title: "Original bank alert") {
                        Text(raw)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Palette.inkSoft)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(16)
        }
        .canvasBackground()
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Palette.surface)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Palette.ink, in: .capsule)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .tag: TagSheet(txn: t) { tag, all in await save(all ? "Tagged every \(t.displayMerchant) transaction, past and future" : "Tag saved") {
                try await API(auth: auth).edit(transaction: t.id, tag: .some(tag), applyToMerchant: all)
            } }
            case .category: CategorySheet(txn: t) { cat, all in await save(all ? "All \(t.displayMerchant) transactions are now \(cat)" : "Category updated") {
                try await API(auth: auth).edit(transaction: t.id, category: cat, applyToMerchant: all)
            } }
            case .rename: RenameSheet(txn: t) { name in await save(name == nil ? "Name reset" : "Renamed everywhere, past and future") {
                try await API(auth: auth).rename(merchant: t.raw_merchant ?? t.merchant ?? "", to: name)
            } }
            }
        }
        .task(id: changes.version) { full = try? await API(auth: auth).transaction(id: txn.id) }
    }

    /// Runs an edit; returns an error message for the sheet to show, or nil on success.
    private func save(_ message: String, _ op: () async throws -> Void) async -> String? {
        do {
            try await op()
            changes.bump()
            withAnimation(.snappy) { toast = message }
            Task {
                try? await Task.sleep(for: .seconds(2.5))
                withAnimation(.snappy) { toast = nil }
            }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func action(_ title: String, _ icon: String, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
                Text(title.uppercased()).font(.system(size: 10, weight: .bold, design: .rounded)).tracking(0.8)
            }
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Palette.surface, in: .rect(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Eyebrow(label)
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(Palette.ink)
        }
    }
}

// MARK: - Edit sheets

/// Shared chrome for the edit sheets: title, content, "every transaction from merchant" switch, save.
private struct EditSheetFrame<Content: View>: View {
    let title: String
    let merchant: String
    @Binding var applyAll: Bool
    var showApplyAll = true
    var saveTitle = "Save"
    let onSave: () async -> String?
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var error: String?

    private func submit() {
        Task {
            saving = true
            error = await onSave()
            saving = false
            if error == nil { dismiss() }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    content
                    if showApplyAll {
                        Toggle(isOn: $applyAll) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Every \(merchant) transaction")
                                    .font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                Text("Past ones now, and future ones automatically")
                                    .font(.caption).foregroundStyle(Palette.muted)
                            }
                        }
                        .tint(Palette.mint)
                        .card(padding: 16)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Palette.coral) }
                    Button(action: submit) {
                        if saving { ProgressView().tint(Palette.surface) } else { Text(saveTitle) }
                    }
                    .buttonStyle(InkButtonStyle())
                    .disabled(saving)
                }
                .padding(20)
            }
            .canvasBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveTitle == "Save" ? "Save" : "Done") { submit() }
                        .fontWeight(.bold)
                        .disabled(saving)
                }
            }
        }
        .presentationDetents([.large])
    }
}

private struct TagSheet: View {
    @Environment(Auth.self) private var auth
    let txn: Txn
    let onSave: (String?, Bool) async -> String?
    @State private var tag = ""
    @State private var applyAll = true
    @State private var suggestions: [String] = []
    @FocusState private var focused: Bool

    var body: some View {
        EditSheetFrame(title: "Tag", merchant: txn.displayMerchant, applyAll: $applyAll,
                       saveTitle: tag.trimmingCharacters(in: .whitespaces).isEmpty ? "Remove tag" : "Save tag",
                       onSave: { await onSave(tag.trimmingCharacters(in: .whitespaces).isEmpty ? nil : tag, applyAll) }) {
            HStack(spacing: 8) {
                Text("#").font(.display(22)).foregroundStyle(Palette.mint)
                TextField("date-night, work, trip-goa…", text: $tag)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
            }
            .padding(.horizontal, 16)
            .frame(height: 56)
            .background(Palette.surface, in: .rect(cornerRadius: 16, style: .continuous))
            if !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Your tags")
                    WrapLayout(spacing: 8) {
                        ForEach(suggestions, id: \.self) { s in
                            Button { tag = s } label: {
                                Text("#\(s)")
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    .foregroundStyle(tag == s ? Palette.surface : Palette.ink)
                                    .padding(.horizontal, 12).frame(height: 32)
                                    .background(tag == s ? Palette.mint : Palette.surface, in: .capsule)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .task {
            tag = txn.user_tag ?? ""
            focused = txn.user_tag == nil
            // Most-used first (the API sorts by count); keep the list short enough to see Save.
            suggestions = Array(((try? await API(auth: auth).meta().tags.map(\.name)) ?? []).prefix(12))
        }
    }
}

private struct CategorySheet: View {
    let txn: Txn
    let onSave: (String, Bool) async -> String?
    @State private var category = ""
    @State private var applyAll = true

    var body: some View {
        EditSheetFrame(title: "Category", merchant: txn.displayMerchant, applyAll: $applyAll,
                       onSave: { await onSave(category, applyAll) }) {
            VStack(spacing: 0) {
                ForEach(allCategories, id: \.self) { c in
                    Button { category = c } label: {
                        HStack(spacing: 12) {
                            CategoryIcon(category: c, size: 34)
                            Text(c).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                            Spacer()
                            if category == c {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.mint).font(.system(size: 20))
                            }
                        }
                        .padding(.vertical, 8)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    if c != allCategories.last { Perforation().padding(.leading, 46) }
                }
            }
            .card(padding: 14)
        }
        .onAppear { category = txn.category }
    }
}

private struct RenameSheet: View {
    let txn: Txn
    let onSave: (String?) async -> String?
    @State private var name = ""
    @State private var applyAll = true

    var body: some View {
        EditSheetFrame(title: "Rename merchant", merchant: txn.displayMerchant, applyAll: $applyAll, showApplyAll: false,
                       saveTitle: name.trimmingCharacters(in: .whitespaces).isEmpty ? "Reset to bank name" : "Rename",
                       onSave: { await onSave(name.trimmingCharacters(in: .whitespaces).isEmpty ? nil : name) }) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Show it as")
                TextField(prettyMerchant(txn.raw_merchant ?? txn.merchant ?? ""), text: $name)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .background(Palette.surface, in: .rect(cornerRadius: 16, style: .continuous))
                Text("Applies to every past and future transaction the bank sends as “\(txn.raw_merchant ?? txn.merchant ?? "")”. Leave empty to go back to the bank's name.")
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
        }
        .onAppear { name = txn.isRenamed ? (txn.merchant ?? "") : "" }
    }
}

struct SettingsView: View {
    @Environment(Auth.self) private var auth
    @State private var meta: Meta?
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(eyebrow: "Finny · v1.0", title: "Settings")

                    Card(title: "Connected to") {
                        HStack(spacing: 12) {
                            Image(systemName: "server.rack")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Palette.mint)
                                .frame(width: 40, height: 40)
                                .background(Palette.mintSoft, in: .rect(cornerRadius: 13, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(auth.serverURL?.host() ?? "—").font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ink)
                                Text("Read-only").font(.caption).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            if let base = auth.serverURL {
                                Link(destination: base) {
                                    Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.ink)
                                        .frame(width: 34, height: 34).background(Palette.sunken, in: .circle)
                                }
                            }
                        }
                    }

                    if let meta {
                        Card(title: "Cards") {
                            VStack(spacing: 0) {
                                ForEach(meta.cards) { c in
                                    HStack {
                                        Text(c.label).font(.system(size: 15, weight: .semibold, design: .rounded))
                                            .foregroundStyle(c.active ? Palette.ink : Palette.muted)
                                        Spacer()
                                        Text(Money.symbol(c.currency) + " " + c.currency)
                                            .font(.system(size: 11, weight: .bold, design: .rounded)).tracking(0.8)
                                            .foregroundStyle(Palette.inkSoft)
                                            .padding(.horizontal, 8).padding(.vertical, 4)
                                            .background(Palette.sunken, in: .capsule)
                                    }
                                    .padding(.vertical, 11)
                                    if c.id != meta.cards.last?.id { Perforation() }
                                }
                            }
                        }
                        if let fx = meta.fx {
                            Card(title: "Exchange rate", trailing: fx.date) {
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    AmountText(amount: 1, currency: "SGD", size: 22)
                                    Text("=").font(.display(20)).foregroundStyle(Palette.muted)
                                    AmountText(amount: fx.rate, currency: "INR", size: 22)
                                }
                                Text("ECB reference rate. Finny never adds SGD and INR together unless you ask.")
                                    .font(.caption).foregroundStyle(Palette.muted)
                            }
                        }
                    }

                    Button { confirmSignOut = true } label: {
                        Text("Sign out")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(Palette.coral)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Palette.surface, in: .rect(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    Text("Cards, tags and splits are managed from the web dashboard and the Telegram bot.")
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of Finny?", isPresented: $confirmSignOut) {
                Button("Sign out", role: .destructive) { auth.signOut() }
            }
            .task { meta = try? await API(auth: auth).meta() }
        }
    }
}
