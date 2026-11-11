# LRX Torn Tracker v1.6.11

## Automatic membership

- App login now connects Premium automatically with the saved Torn account. No separate verification, Connect account button or remember checkbox.
- Sessions refresh automatically after expiry and reconnect after app restart. Concurrent checks share one login; temporary failures back off without affecting free tools.
- Official incoming Xanax logs activate membership for the sender immediately, including players who have not opened the app yet. Two Xanax adds 30 days at the default price.
- Existing pending official-log receipts are settled automatically; duplicate transfers never add time twice.
- Payment activation never creates an authenticated session or lets another account claim the sender's membership. Account ownership and all paid operations remain checked by the server.
- Privacy details remain in a compact informational section. No acceptance is recorded or requested.

## Update

Existing users can install through the app update button. Local keys, settings and profiles are preserved. New users can download `LRX-Torn-Tracker-Windows-x64.zip`, extract it and run TornTracker.exe.

Validation: 87 automated unit/integration tests, integrated Premium and advanced-module UI checks, plus packaged Electron startup checks.
