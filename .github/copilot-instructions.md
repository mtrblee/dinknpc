# Project guidelines

## Product and source of truth
- DinkNow is a doubles-only iPhone pickleball app with persistent groups, registered players, games, individual standings, and fixed-team tournaments.
- Read [product rules](../docs/product.md) before behavior changes and [tournament rules](../docs/tournaments.md) before changing schedules, seeds, scoring, byes, or resets. Clarify missing rules instead of inventing them.
- Money is simulated USD only. Never introduce deposits, transfers, settlement, real prizes, or payment integrations without a separately approved scope.
- Follow [README](../README.md) for setup, [authentication](../docs/authentication.md) for account behavior, and [Azure operations](../docs/azure.md) for persistence/deployment.
- Ask before adding dependencies, frameworks, services, or significant architecture changes. Keep implementations focused and preserve unrelated work.

## Architecture and invariants
- React Native 0.88 / Expo SDK 58, React 19.3, strict TypeScript, and Node.js 24. Use React Native instance types for component refs (for example, `ScrollViewInstance`). Keep the Expo compatibility checks; do not assume Expo Go verification proves a release build works.
- `App.tsx` manages state-based bottom navigation, API-backed view state, and local drafts. There is no navigation framework. Keep screens in `src/features`.
- `src/domain` contains pure shared rules and colocated tests; `src/types` contains shared models. The Azure API imports these rules rather than reimplementing calculations.
- `src/services` isolates Supabase authentication, SecureStore, and the authenticated Azure API client. Never fall back to local-only successful writes or empty results after a backend failure.
- `api/src` owns HTTP authorization and transactional SQL persistence. `api/sql` contains additive migrations; `infra` contains Azure resource definitions.
- Persist groups, members, games, and tournaments in Azure SQL. Sign-out clears device state and drafts, not saved data. Keep account caches and pending requests isolated by user ID.
- Enforce permissions in the API and transaction layer, not just the UI. Public discovery does not grant access to rosters, results, or tournaments.
- Keep casual and tournament scoring separate. Tagged tournament games must not bypass target/advancement/reset rules through ordinary game endpoints.
- Derive standings from completed games. Use integer cents, reject unsafe totals, and never award played-game statistics for tournament byes.
- Retain row-version checks and idempotent retries. Creation retries must not duplicate records after unrelated group changes.
- Preserve drafts across normal page/tab navigation. Use unique sibling React keys while preserving per-account remount boundaries.

## Authentication and credentials
- Supabase manages email/password accounts, email-code confirmation, display names, and curated avatar IDs. Azure mirrors verified ID/name/avatar records; membership names remain snapshots, while avatars are current across groups/history. Group rosters and lookup responses never expose email.
- Use native SecureStore for sessions. Do not store passwords, log tokens/codes/request bodies, or add an unprotected storage fallback.
- Treat user-editable metadata as display data, never authorization. Validate the current account and target player eligibility on the server.
- `EXPO_PUBLIC_` values are embedded in the app. Only public configuration belongs there; never put service-role keys, SMTP credentials, SQL credentials, or signing secrets in them.
- Azure runtime SQL access uses managed identity. The application's SQL SID uses its **client ID** (`API_IDENTITY_CLIENT_ID`), whereas Azure RBAC assignments use its **object/principal ID**.
- Never commit credentials, signing files, budget-recipient addresses, or real player fixtures. Use synthetic data and supported interactive sign-in/credential managers.

## Verification
- Use existing tooling: `npm ci` and `npm ci --prefix api` restore the two packages.
- Run relevant Node tests with `npm test` or `npm run test:coverage`; run `npm run typecheck` for both app and API and `npx expo install --check` for SDK compatibility.
- Build server changes with `npm run build --prefix api`. Validate changed Bicep before provisioning.
- Cover distinct participants, invalid scores, shared ranks, zero-sum simulated money, deletion/reset recalculation, permission denial, concurrency, and idempotency as relevant.
- Tournament changes must cover all supported team counts, exact pairings, tie rules, byes, progression, score boundaries, correction dependencies, and normal-route bypass prevention.
- Live SQL tests require explicit development-database approval and `RUN_SQL_INTEGRATION=1`. Use exact synthetic fixtures and explicit write transactions for cleanup; never clear user data to make tests pass.
- Administrator SQL tests and public health checks do not prove runtime authentication works. Verify authenticated app/API writes and persistence through an independent read.
- No linter or native UI test runner is configured. Report component mocks, JS exports, actual device checks, and unverified behavior separately. Do not claim native behavior from domain/web tests.
- Report compatibility/advisory warnings; do not suppress them or use forced dependency downgrades as a shortcut.

## Development and deployment
- `npm start` is localhost-only. `npm run start:device` enables Expo Go LAN access; use only a trusted reachable network and do not bypass firewalls or expose Metro publicly.
- Unset `CI` for interactive Expo development: CI disables Metro file watching and can serve stale screens. When diagnosing stale UI, verify the served bundle, not just source files.
- Windows cannot locally compile native iOS builds or run Apple's simulator. EAS cloud builds or a Mac are required for signed iOS builds.
- Keep database migrations additive and deployment/SQL access scoped to the approved subscription, resource group, identity, and environment. Do not increase cost settings without approval.
- Update related documentation with behavior, commands, schema, or setup changes. Outline substantial work and implement reviewable slices.
- Do not commit, push, build for distribution, publish, or deploy without explicit approval. Backend deployment approval does not authorize App Store/TestFlight submission.
- For each newly approved TestFlight/App Store release, increment the app's patch version (1.0.1, 1.0.2, ...), unless the user specifies another version. Keep `app.json`'s `expo.version`, `package.json`, and the root package-lock versions aligned. Reuse that app version for retries of the same release; keep EAS `autoIncrement` enabled for the separate numeric iOS build number. See the [release version policy](../README.md#release-version-policy).

## App Store release gate
- Read [release readiness](../docs/release-readiness.md) before production authentication or App Store work. The development prototype is **not release-ready**.
- Public email delivery, password recovery, in-app account deletion, privacy/support information, and release configuration remain open work. Never disable verification or weaken permissions to unblock signup/review.
- Ask for ownership/history-retention decisions before implementing account deletion across Supabase and Azure.
- Confirm Apple/Expo account ownership, bundle identifier, production environments, costs, and signing strategy before configuring release builds.
- Require signed TestFlight testing against the intended backend, including non-team signup, verification, recovery, deletion, and account isolation. Do not equate EAS upload with App Review approval or public release.
- `.vscode/mcp.json` uses interactive GitHub OAuth; never store tokens in that file.
