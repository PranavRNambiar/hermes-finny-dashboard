import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import UIKit

/// Signs in against Finny's own OAuth server (dashboard/lib/finny/auth.ts) with PKCE.
/// The app is the public client `finny-ios`; the user only types the owner password
/// on the server's sign-in page. Tokens live in the Keychain.
@MainActor
@Observable
final class Auth: NSObject {
    static let clientID = "finny-ios"
    static let redirectURI = "finny://oauth/callback"

    private(set) var isSignedIn = false
    private(set) var isWorking = false
    var errorMessage: String?

    var serverURL: URL? {
        didSet {
            UserDefaults.standard.set(serverURL?.absoluteString, forKey: "serverURL")
            SharedStore.serverURL = serverURL   // widgets read it from the App Group
        }
    }

    private var accessToken: String?
    private var accessExpiry = Date.distantPast
    private var refreshTask: Task<String, Error>?

    override init() {
        super.init()
        if let s = UserDefaults.standard.string(forKey: "serverURL") { serverURL = URL(string: s) }
        SharedStore.serverURL = serverURL
        if let token = TokenStore.read() { TokenStore.save(token) }  // move older tokens into the shared group
        isSignedIn = serverURL != nil && TokenStore.read() != nil
        if isSignedIn, let a = TokenStore.readAccess() { (accessToken, accessExpiry) = (a.token, a.expiry) }
    }

    // MARK: Sign in

    func signIn(server: String) async {
        errorMessage = nil
        guard let base = Self.normalise(server) else {
            errorMessage = "Enter your dashboard URL, e.g. https://finny.vercel.app"
            return
        }
        isWorking = true
        defer { isWorking = false }

        let verifier = Self.randomURLSafe(32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = Self.randomURLSafe(16)

        var comps = URLComponents(url: base.appending(path: "oauth/authorize"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            .init(name: "client_id", value: Self.clientID),
            .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "scope", value: "finny.read finny.write"),
            .init(name: "state", value: state),
        ]

        do {
            let callback = try await webAuth(url: comps.url!)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.first(where: { $0.name == "state" })?.value == state,
                  let code = items.first(where: { $0.name == "code" })?.value
            else { throw AuthError.message("Sign-in was interrupted. Try again.") }

            serverURL = base
            try await requestTokens([
                "grant_type": "authorization_code",
                "code": code,
                "client_id": Self.clientID,
                "redirect_uri": Self.redirectURI,
                "code_verifier": verifier,
            ])
            isSignedIn = true
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            // User closed the sheet; nothing to report.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        TokenStore.delete()
        ResponseCache.clear()
        accessToken = nil
        accessExpiry = .distantPast
        isSignedIn = false
    }

    // MARK: Tokens

    /// A valid access token, refreshing it first if it has expired.
    func validAccessToken(forceRefresh: Bool = false) async throws -> String {
        if !forceRefresh, let t = accessToken, accessExpiry > .now.addingTimeInterval(30) { return t }
        if let running = refreshTask { return try await running.value }
        let task = Task { () throws -> String in
            defer { refreshTask = nil }
            guard let rt = TokenStore.read() else { throw AuthError.signedOut }
            do {
                try await requestTokens(["grant_type": "refresh_token", "refresh_token": rt, "client_id": Self.clientID])
            } catch AuthError.rejected {
                signOut()
                throw AuthError.signedOut
            }
            return accessToken!
        }
        refreshTask = task
        return try await task.value
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String?
        let expires_in: Double
    }

    private func requestTokens(_ form: [String: String]) async throws {
        guard let base = serverURL else { throw AuthError.signedOut }
        var req = URLRequest(url: base.appending(path: "oauth/token"))
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var comps = URLComponents()
        comps.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = comps.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
            .data(using: .utf8)

        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 400 || status == 401 { throw AuthError.rejected }
        guard status == 200 else { throw AuthError.message("Server error (\(status)).") }
        let tok = try JSONDecoder().decode(TokenResponse.self, from: data)
        accessToken = tok.access_token
        accessExpiry = .now.addingTimeInterval(tok.expires_in)
        TokenStore.saveAccess(tok.access_token, expiry: accessExpiry)
        if let rt = tok.refresh_token { TokenStore.save(rt) }
    }

    // MARK: Helpers

    private func webAuth(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "finny") { url, error in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: error ?? AuthError.message("Sign-in failed.")) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            session.start()
        }
    }

    static func normalise(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host() != nil else { return nil }
        return url
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.base64URL
    }
}

extension Auth: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}

enum AuthError: LocalizedError {
    case signedOut, rejected, message(String)
    var errorDescription: String? {
        switch self {
        case .signedOut: "You've been signed out."
        case .rejected: "The server rejected the sign-in."
        case .message(let m): m
        }
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
