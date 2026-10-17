import Foundation

/// One URLSession for the app and widgets: waits for a connection instead of failing at once,
/// retries a dropped connection once, and turns raw network errors into plain words.
enum Net {
    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.waitsForConnectivity = true            // coming back from background / lift / MRT: wait, don't fail
        c.timeoutIntervalForRequest = 20
        c.timeoutIntervalForResource = 35
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    struct Offline: LocalizedError {
        let errorDescription: String?
    }

    private static let transient: Set<URLError.Code> = [
        .networkConnectionLost, .timedOut, .cannotConnectToHost, .notConnectedToInternet,
        .dnsLookupFailed, .cannotFindHost, .secureConnectionFailed, .internationalRoamingOff, .dataNotAllowed,
    ]

    static func data(for req: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: req)
        } catch let e as URLError where e.code == .cancelled {
            throw CancellationError()            // a screen moved on; not an error worth showing
        } catch let e as URLError where transient.contains(e.code) {
            try await Task.sleep(for: .milliseconds(800))
            do {
                return try await session.data(for: req)
            } catch let e as URLError where e.code == .cancelled {
                throw CancellationError()
            } catch let e as URLError {
                throw Offline(errorDescription: e.code == .notConnectedToInternet || e.code == .dataNotAllowed
                    ? "You're offline. Showing what Finny last saw."
                    : "Couldn't reach Finny just now. Pull down to try again.")
            }
        }
    }
}
