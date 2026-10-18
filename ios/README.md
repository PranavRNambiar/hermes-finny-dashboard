# Finny for iOS

SwiftUI app (iOS 17+) over the dashboard's `/api/v1/*` endpoints. No third-party dependencies.

- **Overview**: spend for a period per currency, change vs the previous period, daily chart, categories (tap one for its transactions), top merchants, largest.
- **Activity**: every transaction with merchant search and currency/card/category filters.
- **Insights**: 12-month trend, who owes you (pending splits), recurring charges.
- **Settings**: server, cards, SGD→INR rate, sign out.

Sign-in uses the dashboard's OAuth server (public client `finny-ios`, PKCE, redirect `finny://oauth/callback`).
You type the `FINNY_OWNER_PASSWORD` on the server's page; the app keeps only a refresh token, in the Keychain.

```bash
cd ios && xcodegen generate && open Finny.xcodeproj
```

Pick your team under Signing & Capabilities to run it on your phone.
