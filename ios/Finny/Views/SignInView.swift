import SwiftUI

struct SignInView: View {
    @Environment(Auth.self) private var auth
    @AppStorage("serverURL") private var savedServer = ""
    @State private var server = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("finny")
                .font(.display(22, .heavy))
                .tracking(-0.5)
                .foregroundStyle(Palette.mint)
            Text("Know where\nevery dollar\nwent.")
                .font(.display(46, .bold))
                .tracking(-1.6)
                .lineSpacing(-4)
                .foregroundStyle(Palette.ink)
                .padding(.top, 12)
            Text("Your card alerts, parsed and sorted.\nNo spreadsheets. No guilt. Some guilt.")
                .font(.system(size: 16, weight: .medium, design: .rounded))
                .foregroundStyle(Palette.inkSoft)
                .padding(.top, 14)

            Spacer()

            VStack(alignment: .leading, spacing: 10) {
                Eyebrow("Dashboard URL")
                TextField("finny.vercel.app", text: $server)
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(Palette.ink)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit(signIn)
                    .padding(.horizontal, 16)
                    .frame(height: 54)
                    .background(Palette.surface, in: .rect(cornerRadius: 16, style: .continuous))
                if let err = auth.errorMessage {
                    Text(err).font(.footnote).foregroundStyle(Palette.coral)
                }
                Button(action: signIn) {
                    if auth.isWorking { ProgressView().tint(Palette.surface) } else { Text("Continue") }
                }
                .buttonStyle(InkButtonStyle())
                .disabled(server.trimmingCharacters(in: .whitespaces).isEmpty || auth.isWorking)
                .opacity(server.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                .padding(.top, 6)
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 10))
                    Text("You'll enter your owner password on the next screen.")
                }
                .font(.caption)
                .foregroundStyle(Palette.muted)
                .padding(.top, 4)
            }
        }
        .padding(24)
        .canvasBackground()
        .onAppear { if server.isEmpty { server = savedServer } }
    }

    private func signIn() {
        Task { await auth.signIn(server: server) }
    }
}
