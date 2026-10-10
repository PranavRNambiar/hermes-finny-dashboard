import SwiftUI
import UIKit

// Finny design language: calm ledger.
// Navy ink on a cool grey canvas, white cards with soft corners, uppercase micro-labels,
// amounts set like a receipt (small raised currency mark, tabular digits), one mint accent.

enum Palette {
    static let canvas = Color(light: 0xF0F1F5, dark: 0x0B0F14)
    static let surface = Color(light: 0xFFFFFF, dark: 0x151B23)
    static let sunken = Color(light: 0xE6E8EF, dark: 0x1D2530)
    static let ink = Color(light: 0x1C2547, dark: 0xEEF1F8)
    static let inkSoft = Color(light: 0x5F6485, dark: 0xA3A9C2)
    static let muted = Color(light: 0x979DB5, dark: 0x6B7290)
    static let hairline = Color(light: 0xDDE0EA, dark: 0x263040)
    static let mint = Color(light: 0x12B886, dark: 0x3DDBA5)
    static let mintSoft = Color(light: 0xDDF6EC, dark: 0x113A2E)
    static let coral = Color(light: 0xE8590C, dark: 0xFF8A4C)
    /// The dark "ink card" used for hero totals in both modes.
    static let inkCard = Color(hex: 0x0E2A2F)
    static let inkCardHighlight = Color(hex: 0x16444B)
}

enum Theme {
    /// Muted pastel chip (background, foreground) per category.
    static func chip(forCategory c: String) -> (bg: Color, fg: Color) {
        let (bg, fg, dbg, dfg): (UInt32, UInt32, UInt32, UInt32) = switch c {
        case "Food & Drink": (0xFFF0DB, 0xB25E09, 0x3A2A12, 0xFFB45C)
        case "Transport": (0xE1ECFF, 0x2457C5, 0x152540, 0x8AB4FF)
        case "Shopping": (0xFFE3EC, 0xC2255C, 0x3A1724, 0xFF8FB3)
        case "Subscriptions": (0xEDE5FF, 0x6741D9, 0x241C3D, 0xB49CFF)
        case "Health & Fitness": (0xDDF6EC, 0x0C8A62, 0x113A2E, 0x5FE0B2)
        case "Travel": (0xDFF5FA, 0x0B7285, 0x0F3038, 0x66D9EF)
        case "Utilities & Bills": (0xE9ECF2, 0x495074, 0x222A36, 0xB3BAD4)
        case "Rent & Housing": (0xFFE8E3, 0xC92A2A, 0x3D1A17, 0xFF8F87)
        case "Entertainment": (0xFBE4FF, 0xA61E9E, 0x351838, 0xF08CEB)
        case "Education": (0xE5E8FF, 0x3B49C9, 0x1D2140, 0x9CA6FF)
        default: (0xEDEEF2, 0x5F6485, 0x232A35, 0xA3A9C2)
        }
        return (Color(light: bg, dark: dbg), Color(light: fg, dark: dfg))
    }

    static func symbol(forCategory c: String) -> String {
        switch c {
        case "Food & Drink": "cup.and.saucer.fill"
        case "Transport": "tram.fill"
        case "Shopping": "bag.fill"
        case "Subscriptions": "arrow.triangle.2.circlepath"
        case "Health & Fitness": "figure.run"
        case "Travel": "airplane"
        case "Utilities & Bills": "bolt.fill"
        case "Rent & Housing": "house.fill"
        case "Entertainment": "popcorn.fill"
        case "Education": "book.closed.fill"
        default: "arrow.left.arrow.right"
        }
    }

    static func cardLabel(_ card: String) -> String {
        switch card {
        case "dbs": "DBS"
        case "ocbc": "OCBC"
        default: card.capitalized
        }
    }
}

// MARK: Type

extension Font {
    /// Big rounded display numerals/headings with tight tracking (apply .tracking separately).
    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

/// UPPERCASE tracked micro-label, the backbone of the hierarchy.
struct Eyebrow: View {
    let text: String
    var color: Color = Palette.muted
    init(_ text: String, color: Color = Palette.muted) { self.text = text; self.color = color }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .tracking(1.2)
            .foregroundStyle(color)
    }
}

// MARK: Money

enum Money {
    static func symbol(_ currency: String) -> String {
        switch currency {
        case "SGD": "S$"
        case "INR": "₹"
        case "USD": "$"
        default: currency
        }
    }

    static func number(_ amount: Double, _ currency: String) -> String {
        let digits = currency == "INR" || amount >= 10_000 ? 0 : 2
        let locale = currency == "INR" ? Locale(identifier: "en_IN") : Locale(identifier: "en_SG")
        return amount.formatted(.number.precision(.fractionLength(digits)).locale(locale))
    }

    static func format(_ amount: Double, _ currency: String, compact: Bool = false) -> String {
        if compact && amount >= 100_000 {
            return symbol(currency) + amount.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
        }
        return symbol(currency) + number(amount, currency)
    }
}

/// Receipt-style amount: a small raised currency mark next to large tabular digits.
struct AmountText: View {
    let amount: Double
    let currency: String
    var size: CGFloat = 17
    var weight: Font.Weight = .semibold
    var color: Color = Palette.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.08) {
            Text(Money.symbol(currency))
                .font(.display(size * 0.5, .semibold))
                .foregroundStyle(color.opacity(0.55))
                .baselineOffset(size * 0.32)
            Text(Money.number(amount, currency))
                .font(.display(size, weight).monospacedDigit())
                .tracking(size > 30 ? -size * 0.03 : 0)
                .foregroundStyle(color)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
    }
}

// MARK: Surfaces

struct CardStyle: ViewModifier {
    var padding: CGFloat = 18
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: .rect(cornerRadius: 24, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = 18) -> some View { modifier(CardStyle(padding: padding)) }
    func canvasBackground() -> some View { background(Palette.canvas.ignoresSafeArea()) }
}

/// Titled card section.
struct Card<Content: View>: View {
    let title: String
    var trailing: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Eyebrow(title)
                Spacer()
                if let trailing { Eyebrow(trailing) }
            }
            content
        }
        .card()
    }
}

/// Dashed "perforation" rule, Finny's receipt motif.
struct Perforation: View {
    var color: Color = Palette.hairline
    var body: some View {
        Line()
            .stroke(color, style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [2, 5]))
            .frame(height: 1.2)
    }
    private struct Line: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: 0, y: r.midY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
            return p
        }
    }
}

/// Bottom edge cut like a torn receipt (small scallops).
struct ReceiptEdge: Shape {
    var radius: CGFloat = 26
    var scallop: CGFloat = 5
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: radius))
        p.addArc(center: CGPoint(x: radius, y: radius), radius: radius, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX - radius, y: 0))
        p.addArc(center: CGPoint(x: r.maxX - radius, y: radius), radius: radius, startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        let count = max(1, Int(r.width / (scallop * 2)))
        let step = r.width / CGFloat(count)
        for i in (0..<count).reversed() {
            let x = CGFloat(i) * step
            p.addQuadCurve(to: CGPoint(x: x, y: r.maxY), control: CGPoint(x: x + step / 2, y: r.maxY - scallop * 1.6))
        }
        p.closeSubpath()
        return p
    }
}

/// Category marker: tinted rounded square with a glyph.
struct CategoryIcon: View {
    let category: String
    var size: CGFloat = 40
    var body: some View {
        let c = Theme.chip(forCategory: category)
        Image(systemName: Theme.symbol(forCategory: category))
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(c.fg)
            .frame(width: size, height: size)
            .background(c.bg, in: .rect(cornerRadius: size * 0.34, style: .continuous))
    }
}

/// UPPERCASE category tag in its pastel tint.
struct CategoryTag: View {
    let category: String
    var body: some View {
        let c = Theme.chip(forCategory: category)
        Text(category.uppercased())
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .tracking(0.9)
            .foregroundStyle(c.fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(c.bg, in: .capsule)
    }
}

/// Pill segmented control in the Finny style (replaces the system segmented picker).
struct PillPicker<T: Hashable>: View {
    let options: [T]
    @Binding var selection: T
    let label: (T) -> String
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { o in
                let on = o == selection
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = o }
                } label: {
                    Text(label(o).uppercased())
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .tracking(0.8)
                        .foregroundStyle(on ? Palette.surface : Palette.inkSoft)
                        .padding(.vertical, 9)
                        .frame(maxWidth: .infinity)
                        .background {
                            if on { Capsule().fill(Palette.ink).matchedGeometryEffect(id: "pill", in: ns) }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Palette.sunken, in: .capsule)
    }
}

struct CurrencyPicker: View {
    @Binding var mode: CurrencyMode
    var body: some View {
        Menu {
            Picker("Currency", selection: $mode) {
                Section("Per card currency") {
                    Text("S$  SGD only").tag(CurrencyMode.sgd)
                    Text("₹  INR only").tag(CurrencyMode.inr)
                }
                Section("Everything, converted") {
                    Text("All in S$").tag(CurrencyMode.allSGD)
                    Text("All in ₹").tag(CurrencyMode.allINR)
                }
            }
        } label: {
            HStack(spacing: 4) {
                if mode.isCombined { Image(systemName: "arrow.triangle.merge").font(.system(size: 10, weight: .bold)) }
                Text(mode.label).font(.system(size: 13, weight: .bold, design: .rounded))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .heavy))
            }
            .foregroundStyle(mode.isCombined ? Palette.surface : Palette.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(mode.isCombined ? Palette.ink : Palette.surface, in: .capsule)
        }
    }
}

/// Large left-aligned screen title used instead of the system navigation title.
struct ScreenHeader<Trailing: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow(eyebrow)
                Text(title).font(.display(32)).tracking(-0.8).foregroundStyle(Palette.ink)
            }
            Spacer()
            trailing
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(eyebrow: String, title: String) {
        self.init(eyebrow: eyebrow, title: title) { EmptyView() }
    }
}

struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?
    var body: some View {
        VStack(spacing: 12) {
            Text("🫠").font(.system(size: 44))
            Text("Couldn't reach Finny").font(.display(20)).foregroundStyle(Palette.ink)
            Text(message).font(.subheadline).foregroundStyle(Palette.inkSoft).multilineTextAlignment(.center)
            if let retry {
                Button("Try again", action: retry).buttonStyle(InkButtonStyle()).frame(maxWidth: 200)
            }
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}

struct InkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(Palette.surface)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Palette.ink, in: .rect(cornerRadius: 16, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: Copy

/// Finny's voice: one dry line about the period, based on the change vs the previous one.
enum Quip {
    static func forChange(_ pct: Double?) -> String {
        guard let pct else { return "Every dollar, accounted for." }
        switch pct {
        case ..<(-25): return "Restraint looks good on you."
        case ..<(-5): return "Trending the right way. Quietly."
        case ..<5: return "Steady. Suspiciously steady."
        case ..<25: return "A little looser than last time."
        default: return "Someone's been treating themselves."
        }
    }
}

// MARK: Colour helpers

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}
