# Torn ID, privacy and remuneration findings

Checked against official sources on **11 November 2026**. This document records the implementation decision and remaining operator decisions; it is not a regulator ruling specifically about Torn IDs or a claim that deploying these files alone achieves legal compliance.

## Treat linked Torn IDs as personal data

The [KVKK definition](https://www.kvkk.gov.tr/Icerik/2050/Kisisel-Veriler) covers information about an identified or identifiable natural person. [GDPR Article 4(1)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/) includes indirect identification using online identifiers. The [ICO's identifier guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors) specifically discusses account handles and usernames: knowing a legal name is not required for singling out a user.

**Inference for this application:** a stable Torn ID tied to a verified account, payments and subscription history can distinguish and relate to a player. Treat it and the linked records as personal data. The public availability of an ID does not remove that classification. This does not make it a special-category identifier by itself. Calling an ID pseudonymous, replacing it with a hash, or omitting the real name does not establish anonymity; a small enumerable numeric ID is particularly unsuitable for a claim that an ordinary hash anonymises it. Which statutes apply also depends on the operator, users and territorial scope.

The implementation therefore:

- Derives a user's Torn ID from the official API's key owner, never a self-declared payment recipient or browser role flag.
- Stores only structured verified transfer metadata; does not retain the raw HTML of accepted transfers or unrelated events.
- Stores the operator's receiver API key only in a private server environment file for read-only transfer polling. Ordinary users' login keys remain transient and are not stored by the membership service. The only user-supplied API keys the service stores are Shared Faction Hub collector keys, which a faction leader or co-leader connects with explicit consent (see [Shared Faction Hub](#shared-faction-hub)).
- Keeps ambiguous raw review text for at most the configured 30 days (1–90 allowed), then clears the text while preserving duplicate-prevention metadata. API login keys are used transiently, not persisted by the central service; faction collector keys are the exception described below. Session tokens are stored as hashes; key fingerprints map known keys to owner IDs to coordinate request budgets. These linked identifiers are also private.
- Restricts user history, balances and exports to that authenticated owner. Authorized operators can review records; administrator reads/mutations and manual grants are audited. No public member/payment list exists.
- Provides free authenticated JSON/CSV access to the user's own records, even after premium expiry, and a verified erasure-assessment request queue. Submitting a request does **not** erase data or mark it completed. The operator must assess retention, disputes, duplicate prevention, backups and applicable rights, perform the appropriate deletion/anonymisation, and respond. Audit records are not advertised as anonymous.
- Requires a controller name, contact, HTTPS terms origin and an explicit structured-record retention policy before live identity login/collection. The UI shows these, data categories, purpose, access and key usage in the informational Privacy section. Login copy discloses automatic membership matching at the central service.

The controller still needs to select and document the applicable legal basis for each purpose, define finite retention schedules and erasure/backups procedures, provide the full required privacy notice/rights response process, and assess service-provider/hosting and any international transfers. Necessary contract administration can be a candidate basis where applicable; this must not be assumed for unrelated processing. App login connects membership automatically and informational notices explain the data use; this is not recorded as blanket legal consent and does not purport to solve every KVKK/GDPR legal-basis requirement. KVKK itself says to assess available lawful grounds rather than unnecessarily treating all processing as consent-based. Do not start public collection with a vague or placeholder policy.

## Free data access, possible paid insights

The application's intended distinction is preserved:

- Torn API data access does not depend on sending Xanax.
- All current app features remain free.
- Any later remuneration would concern the richness of additional application-produced analysis, not a sale of Torn Premium or a charge just to access the API.
- Five additional analysis/personalization modules use the server entitlement guard. Existing features remain Free. In-game Xanax collection requires explicit operator opt-in and the technical prerequisites below.

That product distinction is useful, but it is **not official permission** for the Xanax payment arrangement. The [official API acceptable-usage rules](https://www.torn.com/api.html) ask developers to contact Torn before charging users for usage; they also require clear disclosures covering storage, sharing, purpose, key storage/sharing and access level. They do not provide an explicit automatic exemption for charging only for insights. The [game rules](https://www.torn.com/rules.php) also need to be considered when describing an item-funded third-party service.

On 11 November 2026, the operator explicitly requested activation using only in-game Xanax and removal of the mandatory approval-reference field. That software requirement has been removed; no Torn approval or exemption is claimed, and no contact was made on the operator's behalf. Test mode and disabled collection remain the defaults for new installations. An operator must explicitly enable a verified receiver, supported event format and the other technical/privacy prerequisites.

## Optional advanced analysis data

An informational in-app notice explains selected analysis inputs, saved profiles and observations before use; no separate acceptance checkbox is required. Users can pause/resume analysis. Accepted profiles are linked to the verified Torn account; observations are capped at 1000 per module and deleted after two years at most. In these analysis modules, full target rosters are processed transiently and not stored as historical player lists; the separate Shared Faction Hub below does keep its own faction's roster history. Stopping sharing disables advanced calculations without deleting profiles. Free personal exports include these records. Automatic connection stores a service-scoped key fingerprint locally so the key can be verified again after restart; it never persists a server session token or an entitlement claim. These technical controls do not replace the operator’s privacy obligations described above.

An official received-item log can create a membership record for its exact sender before app login. This credits that Torn ID only; it neither authenticates the sender nor creates a bearer session. The owner is checked automatically when that player logs into the app.

## Shared Faction Hub

The Shared Faction Hub is optional and per faction. Nothing is collected for a faction until its Leader or Co-leader connects a collector key with explicit consent. Connecting is the only moment the service asks Torn about the person: the submitted key must belong to the signed-in player, that player must be in the faction being connected, and their Torn position must be Leader or Co-leader. Afterwards the hub decides who may read it from the member list it collected (the key owner and members with the Leader or Co-leader position act as officers); reading the hub never makes a Torn request.

What it stores, in a separate database (`faction-hub-<mode>.sqlite`) kept next to the premium database:

- The collector key, encrypted at rest with AES-256-GCM under a server secret of at least 32 characters, plus a masked reference (`****1234`). The key is never returned by the API, is used only to read that faction's member list while the faction has an active plan, and is deleted when an officer disconnects it or its owner requests erasure. If Torn reports the key as unusable, or its owner leaves the faction, collection pauses.
- Hub settings, including Discord webhook URLs chosen by officers and watched-player lists.
- Member names, levels, positions, activity, status and travel observations about every 5 minutes, and detected travel changes: kept 30 days. The latest observation per current member is kept while they remain in the faction; members who leave are removed at the next collection.
- Hourly and daily activity counts for the faction (no per-player detail): kept 180 days.
- Discord alert delivery records, which include the player name and destination: kept 30 days. Alerts are only queued while the faction has an active plan and within its daily alert quota.
- Hub audit and operator job records: kept 180 days.

Retention runs automatically once a day. Members of the faction can read the shared status and history while the plan is active; officer-only details stay with officers; operators can see collector health and audit records.

A player's own hub records (the latest observation and history about them, travel changes, alert records naming them, collectors whose key they connected with the key masked and webhooks shown only as "configured", and hub audit entries they caused) are part of the free personal data export. Because hub data is not needed for payment disputes or duplicate prevention, an erasure request deletes these hub records at once, deletes any collector key the player connected (pausing that faction's collection), and stops the hub from recording that player again; hub audit records stay for their 180-day period. Connecting a key again later is a new opt-in. The rest of the erasure request is assessed as described above.

Back up the hub database together with the premium database, using SQLite's backup mechanism rather than copying files during WAL activity.
