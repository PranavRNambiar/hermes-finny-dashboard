import SwiftUI

/// Transaction detail laid out as a receipt.
struct TransactionDetailView: View {
    @Environment(Auth.self) private var auth
    let txn: Txn
    @State private var full: Txn?

    var body: some View {
        let t = full ?? txn
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 14) {
                    CategoryIcon(category: t.category, size: 64)
                    Text(t.displayMerchant)
                        .font(.display(22, .semibold))
                        .foregroundStyle(Palette.ink)
                        .multilineTextAlignment(.center)
                    AmountText(amount: t.amount, currency: t.currency, size: 48, weight: .bold)
                    CategoryTag(category: t.category)
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
                        if let tag = t.user_tag { row("Tag", "#\(tag)", accent: true) }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 28)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
                .background(ReceiptEdge(radius: 28).fill(Palette.surface))

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
        .task { full = try? await API(auth: auth).transaction(id: txn.id) }
    }

    private func row(_ label: String, _ value: String, accent: Bool = false) -> some View {
        HStack {
            Eyebrow(label)
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(accent ? Palette.mint : Palette.ink)
        }
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
