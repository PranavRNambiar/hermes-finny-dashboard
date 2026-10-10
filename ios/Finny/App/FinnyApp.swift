import SwiftUI

@main
struct FinnyApp: App {
    @State private var auth = Auth()

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
            .animation(.default, value: auth.isSignedIn)
        }
    }
}

struct RootTabs: View {
    var body: some View {
        TabView {
            HomeView().tabItem { Label("Overview", systemImage: "circle.grid.2x2.fill") }
            ActivityView().tabItem { Label("Activity", systemImage: "list.bullet") }
            InsightsView().tabItem { Label("Insights", systemImage: "chart.bar.fill") }
            SettingsView().tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
        }
        .tint(Palette.ink)
    }
}
