import SwiftUI
import WidgetKit

@main
struct FinnyApp: App {
    @State private var auth = Auth()
    @State private var changes = DataChanges()
    @State private var insights = InsightsStore()
    @Environment(\.scenePhase) private var phase

    init() {
        FeedbackHook.select = { Feedback.play(.select) }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isSignedIn {
                    RootTabs()
                } else {
                    SignInView()
                }
            }
            .environment(auth)
            .environment(changes)
            .environment(insights)
            .onChange(of: phase) { _, p in
                // Coming back to the app: refresh screens and widgets with the latest transactions.
                if p == .active && auth.isSignedIn { changes.bump() }
            }
            .animation(.default, value: auth.isSignedIn)
        }
    }
}

struct RootTabs: View {
    @State private var tab = 0
    var body: some View {
        TabView(selection: $tab) {
            HomeView().tabItem { Label("Overview", systemImage: "circle.grid.2x2.fill") }.tag(0)
            ActivityView().tabItem { Label("Activity", systemImage: "list.bullet") }.tag(1)
            InsightsView().tabItem { Label("Insights", systemImage: "chart.bar.fill") }.tag(2)
            SettingsView().tabItem { Label("Settings", systemImage: "slider.horizontal.3") }.tag(3)
        }
        .tint(Palette.ink)
        .onChange(of: tab) { _, _ in Feedback.play(.tap) }
        // Widget taps: finny://overview, finny://insights/<id>
        .onOpenURL { url in
            switch url.host {
            case "insights": tab = 2
            case "activity": tab = 1
            case "overview": tab = 0
            default: break
            }
        }
    }
}

/// Bumped after any edit so every screen reloads its data.
@MainActor
@Observable
final class DataChanges {
    var version = 0
    func bump() {
        version += 1
        WidgetCenter.shared.reloadAllTimelines()   // widgets pick up edits and new transactions right away
    }
}
