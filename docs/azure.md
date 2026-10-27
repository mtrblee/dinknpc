# Azure persistence

## Architecture and access

The iPhone app calls a TypeScript Azure Functions v4 API using the current
Supabase access token. The API validates the account through Supabase and its
restricted verified-player RPC before opening a SQL connection. It never trusts
a submitted owner ID, player name, win total, or simulated-money balance.

### Latest completed-game activity

The summary API adds `latestCompletedAt` using a single SQL
aggregate for completed-game count and `MAX(completed_at)` per authorized group.
It reuses the existing nullable timestamps, needs no schema migration, and does
not transfer game histories. Local summaries derived from loaded groups use the
same rule, including after scoring and deletion. Pending games, byes, group
creation and profile edits do not move a group up Home's activity ordering.
Clients validate canonical UTC timestamps, tolerate older responses with an
explicit unavailable-date label, and format known dates in the device's locale.
Both main Groups sections display the date but retain their existing section
order; only Home's three-group preview is sorted by completion activity.

**Approved API-only update deployed to development on 2026-10-27.**

- Deployment `bcd1f202-0829-43b9-9f3c-71309cc9a11f` completed at
  `2026-10-27T18:35:22.1994375Z`. An independent SCM query confirmed status `4`,
  active and complete; the CLI's empty result fields were not used as proof.
- The production package contained 8,363 entries and 20,869,810 bytes. SHA-256:
  `FCE00E5452ED12C51B538CB68EDA94CB66D3EA6C9FAE4121EC4121163B4B8C44`.
  Seven summary tests and eight roles/player-code regressions passed against
  its actual staged compiled modules and locked production dependencies.
- Local validation passed 79 targeted tests, strict app/API type checks and
  the API build. The live SQL group-options workflow verified summary/detail
  parity, pending-game exclusion, latest completion, deletion fallback,
  historical NULL dates, empty groups and owner/member access. Its synthetic
  fixtures were cleaned up.
- All 12 app-setting names, value fingerprints and slot flags remained
  unchanged. Both the HTTP function and the one-minute account-deletion
  worker remained registered. Health returned `200`; unauthenticated groups
  and profile requests returned `401`; a nonexistent deletion receipt returned
  `404`, exercising the live managed-identity SQL connection without writes.
- No migration, grants, firewall, hosting or budget changes were needed.
  No new native build was created; reload Expo Go for the updated UI.

Actual-component smoke checks covered Home ordering before truncation, both
Groups sections, compact Settings and Groups-tab navigation/late-open guards.
The served iOS bundle was also checked. These checks are not authenticated
iPhone layout or touch acceptance. The five existing Expo SDK patch
compatibility recommendations and two production dependency high advisories
remain unchanged; no dependencies were upgraded.

### Configurable tournament scoring

The approved development database/API rollout is **in progress**.
[Migration 011](../api/sql/011_tournament_scoring.sql) adds a nullable per-game
target and a championship-series game number. Zero means an ordinary single
game; series games use 1-3. Legacy rows keep NULL targets and zero ordinals, so
their original pool-to-11 and playoffs-to-15 SQL validation still applies.
No historical scores, IDs, timestamps, roster memberships or tournament JSON
need rewriting.

The score constraint checks the selected target, first legal win and win by
two. Series metadata is championship-only and requires an 11-point target.
The unique game index now includes the series game number, retaining uniqueness
within a match while allowing its second and third games. Shared domain
validation additionally checks ordered game links, two-win completion, no
extra games, fixed scoring rules and per-game identities on score submissions.
Existing table grants remain sufficient.

Apply **only migration 011** to the existing database in a transaction before
deploying this API, not the broad migration runner. The full runner includes
011 for new environments. The old API remains compatible with legacy/default
writes during rollout. `POST /groups/{id}/tournaments/configured` requires
scoring options and prevents an older API from silently ignoring them; the
existing creation route retains old defaults and idempotency fingerprints.
Group revisions and idempotency still serialize scores and allocate at most
one next game after an uncertain or concurrent submission.

Each completed championship game contributes independently to group standings
and activity dates. Clearing a championship series explicitly removes all of
its results, retains the first game's ID as pending, removes later games,
and never reuses their global game IDs. No payments or simulated wagers are added.
Older native clients do not support the new formats; no native release is
included in this rollout.

Azure SQL stores:

- `Players`: durable account or guest records with an `is_guest` discriminator.
  Supabase account metadata remains the source for registered names and avatars;
  the API refreshes this copy during authenticated activity and verified-player lookup.
  Guests have server-generated UUIDs, group-entered names, and the default avatar.
  No passwords or email addresses are copied into SQL.
- `PlayerCodes` (migration 010): six-character primary key and
  nullable unique live-player association. Account deletion sets that association
  to NULL while retaining the code reservation; codes are never reassigned.
- `Groups`: creator, name, group-avatar ID, currency, next game number, creation
  order, and row version.
- `GroupMembers`: the playing roster, including guest IDs and display-name
  snapshots and a group-scoped admin flag. Registered labels are read from
  `Players.display_name`; snapshots supply guest/anonymous labels. Only registered roster members gain
  account access. New groups enroll the creator atomically; existing rosters stay unchanged.
- `Games`: fixed doubles teams/wager, pending/completed status, final scores,
  and nullable UTC creation/completion times.
- `Mutations`: successful request IDs/fingerprints for safe retries.
- `Tournaments`: bounded fixed-team schedule/bracket documents. Linked game
  rows supply results for normal standings; byes have no game row.
- `GroupJoinRequests`: one pending/declined request per group/account. Approvals
  and direct additions add membership and clear that request transactionally.

Creators and added registered members can read a group, add verified players, start games,
and save scores. Owners and admins can cancel/delete games, change public/private
visibility or group avatar, or approve/decline join requests. Group names
are unique per creator, not globally. An unrelated account cannot read a group
even if it knows the group ID.

### Six-character player codes

**Approved migration and API rollout deployed to development on 2026-10-27.**

[010_player_codes.sql](../api/sql/010_player_codes.sql) adds a separate alias
table and backfills existing non-guest, non-anonymous player records. It does
not rewrite UUIDs, names, memberships, group revisions, games, or tournaments.
The full migration runner includes 010 for new environments. For this existing
development database, apply **only 010** in an explicit transaction, then grant
`SELECT, INSERT ON dbo.PlayerCodes TO dinknpc_api`; do not rerun unrelated
normalization/backfill migrations. Keep the existing identity, settings, worker,
hosting and budget unchanged. Deploy the new API only after this migration.

Codes use the 32-symbol alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
Both the backfill and runtime use cryptographic randomness with unbiased
six-symbol selection. A primary key enforces global uniqueness; a filtered
unique index enforces one live code per player. Existing codes are immutable.
Runtime allocation serializes on the player row and retries only collisions
on `PK_PlayerCodes`, rolling back the whole transaction, with at most eight
attempts. Other duplicate-key failures are not swallowed. Backfill collision
search is capped at 128 attempts per player; failure rolls back the migration.

Authenticated `/me`, roster and authorized join-request responses include
optional `code` metadata.
`POST /groups/{id}/players` accepts a code or legacy UUID in the existing
`playerId` field. Authorization precedes code resolution; the existing
Supabase verified-account lookup still decides target eligibility. Commands
and idempotency fingerprints use the canonical UUID. All other ID fields
remain UUIDs. No public directory search or credential based on codes is added.
Clients tolerate old responses, but the code-copy UI reports a missing code
explicitly and never claims a UUID is a short code. Old clients can continue
using full IDs against the updated API.

The FK's `ON DELETE SET NULL` retires codes as part of the existing account
erasure transaction. Only the six-character reservation remains; no account
link or personal metadata is retained there. Runtime grants deliberately
exclude direct UPDATE/DELETE on the alias table. Admin fixture cleanup removes
only codes belonging to its synthetic accounts, including captured retired codes.

Local regression coverage includes normalization, legacy UUIDs, eligibility,
authorization order, canonical fingerprints, strict response parsing, stable
allocation, bounded collision retries, cached profiles and unchanged game
calculations. Three approved live SQL regression workflows passed: durable
groups/games/discovery, creator/admin access, and account lifecycle. They cover
actual code constraints, same-account concurrent allocation, stable aliases,
join-request codes, retirement, and synthetic-fixture cleanup. The format
constraint probe is isolated from the separate one-code-per-player constraint;
the discovery fixture now accounts for automatic creator enrollment.

Verification before approval: 138 distinct targeted regression tests passed
across the initial and follow-up runs. Strict app/API type checks and the API
build passed. An actual-component smoke check with mocked React Native and
clipboard APIs covered loading, exact six-character copy, duplicate taps,
clipboard failure, unavailable-code retry, late account responses, roster
labels and UUID-based selector state. This is not native-device acceptance.
The Expo dependency check still reports the five pre-existing SDK 58 patch
recommendations; no packages were changed.
All eight SQL-store/code-generation mock tests also passed against the compiled
API output. The running LAN Expo server served the updated iOS JavaScript bundle
(5,403,783 bytes), including code copy/retry and shared code labels. No native
release or live authenticated `/me` code lookup has been verified yet.

Rollout verification:

- Applied only migration 010 and the alias table's SELECT/INSERT grants in a
  transaction. Repeating the migration preserved all assigned aliases.
  Ordered SHA-256 snapshots of Players, Groups, GroupMembers, Games and
  Tournaments matched before and after the migration.
- All active registered SQL profiles have a valid six-character code, with no
  codes assigned to guest/anonymous participants. Post-deployment coverage
  checks found zero missing, ineligible or malformed associations.
- Impersonating the actual `dinknpc_api` SQL user verified SELECT/INSERT rights,
  no direct UPDATE/DELETE rights, and successful code retirement on parent-player
  deletion. The temporary synthetic probe was removed within the transaction.
- Existing workstation access was sufficient; no firewall rules were added or
  modified. No hosting, budget, identity mapping or native-version changes.
- Active API deployment **`7e018040-8b61-4720-b6ac-f6f213a157fd`**, independently
  verified status 4, complete and active, completed
  **`2026-10-27T18:00:57.3775333Z`**. This supersedes
  `13f12275-346c-483e-acfc-130c8f3df856`.
- ZIP: 20,869,206 bytes, 8,363 entries; SHA-256
  `612B9258E6B52DB670371F91D0B38044E183075C925015D1759D271A14508065`.
  All eight SQL-store/code-generation mock tests passed against the actual staged
  compiled modules and their production dependencies before upload.
- All 12 app-setting fingerprints and slot flags remained unchanged. Both the
  HTTP function and existing account-deletion worker remained registered.
- Runtime probes: health 200; unauthenticated groups and `/me` 401; fresh
  nonexistent deletion receipt 404 `deletion_not_found`, exercising real
  managed-identity SQL connectivity. These probes are not authenticated
  iPhone UI acceptance.

### Group-admin rollout

Migration [009_group_admins.sql](../api/sql/009_group_admins.sql) adds a non-null
`GroupMembers.is_admin` bit defaulting to false for all existing memberships.
It does not insert creators into existing rosters or grant any existing member
admin privileges. No additional database permission or external service is required.
Run the approved migration **before** deploying this API; do not deploy code
that queries `is_admin` against an unmigrated database.

New group creation inserts its authenticated creator at roster position zero
within the same transaction as the group and idempotency receipt. A replay
returns the saved group without re-enrolling a creator removed later.

`POST /groups/{id}/players/{playerId}/admin` accepts `{ "isAdmin": true|false }`,
requires an owner/admin, `Idempotency-Key`, and the quoted `If-Match` revision.
Promotions revalidate the target account; revocations do not require a provider
lookup. Targets must be other active registered roster members, not the owner.
Roles are checked again under the write transaction, not trusted from client flags.
Group transfer/deletion remain strictly owner-only at both API and store boundaries.

Full group responses now require `isOwner` and `adminIds`; summaries include
`isOwner` but omit the role roster. `canManage` means owner **or** admin,
not ownership. All clients must be updated together: older clients confuse
admin rights with ownership, while updated clients reject missing role metadata.
Removing membership or deleting an account removes its admin flag; transfer
clears the new owner's separate admin flag and gives the former owner no admin grant.

The migration and this role-enabled API are **deployed to development**; see the
verified rollout below. Other environments still need migration 009 before the API.
Local tests cover the real store through synthetic SQL requests as well as
domain, endpoint, client and summary behavior. The live SQL suite includes
creator enrollment, competing grants, independent reloads, revoked permissions,
owner-only actions, and transfer/account-deletion cleanup; run it only with
explicit development-database approval.

The additive `002_group_discovery.sql` migration defaults existing/new groups
to private and adds the request table. Run `npm run migrate --prefix api` before
deploying the updated API; it applies the schema scripts idempotently and grants
only the required table permissions. No group/game rows are deleted.

Authenticated public search returns only names, group avatars, creator display name, player
count, group ID, and the caller's relationship. It uses escaped, parameterized
substring matching and keyset pagination (20 results). Public status does not
grant access to group details. Request submission is serialized with visibility
changes and uses idempotency records, including retries after a decline.
Private transitions retain existing requests. Only owners/admins can list requests;
approval rechecks eligibility and membership is inserted atomically.

The API imports the existing pure [game rules](../src/domain/groups.ts).
Mutations run in serializable SQL transactions; reads use snapshot isolation.
SQL constraints also protect distinct doubles members and valid game states.
Standings and currency-specific simulated totals are derived from completed games, not stored
as editable balances. Deletion is validated and recalculated before committing.

Every mutation has an `Idempotency-Key` UUID. Changes to an existing group also
require its quoted `If-Match` row version, except additive guest and tournament
creation. Those operations serialize against the latest group state and keep
retry keys independent of revisions. Stale versioned writes return HTTP 412; the app
asks the user to refresh rather than silently overwriting another device.
After a timeout or unreadable response, retry the same action without changing
the fields. The client retains the request key until it receives a valid
acknowledgement. Replays return the latest saved group without applying a second
write.

The app only updates its view after a successful server response. It does not
queue offline writes or substitute local-only persistence. Pull down on Home,
Stats, or Groups for changes made elsewhere; tab changes also refresh. A failed
load remains explicit; pull down to retry. Real-time push updates are not implemented.
Sign-out clears the local view and drafts, not the database.

## Startup performance

**Deployed to development on 2026-10-23; hosting-cost settings are unchanged.**
`GET /groups?view=summary` retains the same authentication, profile
synchronization, active-account/deletion checks, and owner/member access rules
as full reads. It returns `{ groups: GroupSummary[] }`: group ID/name/avatar,
currency, owner ID/name, revision, permissions/visibility, `playerCount`, and
`completedGameCount`. It does not return rosters, games, or game counters.
Counts include guests/anonymous roster entries and completed tournament games;
pending games are excluded. Safe-integer validation remains explicit.

After the two active-account guard reads, summaries use one SQL aggregate
statement for the accessible group set, not three detail queries per group.
The full `GET /groups` and `GET /groups/{id}` contracts are unchanged. Home,
Groups, and the account-deletion ownership check use summaries; Stats uses full
groups on demand and group selection uses the single-group endpoint. A summary
never grants edit access or substitutes for complete standings input.
The client handles an older API ignoring `view` by validating its full response
and projecting summaries, with a once-per-client deployment warning. It does
not retry authentication, HTTP, or invalid-data failures as successful loads.
Unknown view values on the new API return 400.

No new migration is needed for the summary query itself. The combined API also
requires account-lifecycle migration 008 and scoped grants, which were applied
to development with explicit approval. Other environments still require a
separately approved migration/configuration rollout.

### Development rollout: 2026-10-23

- Account-lifecycle API deployment: `8b1e61d2-be1b-4568-86c4-b9a530710a28`
  (superseded by the rotating-tournament rollout below).
- Target: `func-dinknpc-3h7pnuwcmrvww` in `rg-dinknpc-dev`.
- Migration 008 and scoped managed-identity permissions applied; no duplicate
  guest names needed normalization. Existing data counts were unchanged after
  synthetic-fixture cleanup; no real account-deletion jobs were submitted.
- All 164 configured unit/API/script tests passed, along with strict types and
  the API build. All five live SQL suites passed across the initial run and a
  focused rerun after fixing two test defects (overlapping synthetic names and
  an outdated guest-access error expectation).
- Post-deployment HTTP checks: `/health` returned 200; an unauthenticated summary
  request returned 401; a random nonexistent deletion receipt returned
  `404 deletion_not_found`, verifying the new route and runtime SQL connectivity.
  HTTP and timer functions were registered. Signed-in device loading and actual
  cold/warm iPhone latency were not measured during deployment.
- No Supabase administrative secret or server performance-log setting was added.
  Account-deletion acceptance/processing remains disabled pending that secret
  and provider acceptance. No SMTP, hosting tier, always-ready, SQL auto-pause,
  budget, or firewall settings were changed. Existing workstation access was
  reused; no temporary firewall rule was needed.

### Rotating-tournament rollout: 2026-10-23

- Successful API deployment: `6a31a23f-fc8e-4639-9e27-3b9bd749a7b5`,
  completed at `2026-10-23T23:32:55.1069128Z`.
- Target remains `func-dinknpc-3h7pnuwcmrvww` in `rg-dinknpc-dev`, Node.js 24.
  The production package includes rotating-partner creation, strict snapshot
  validation, and round-robin completion timestamps. Fixed tournaments remain supported.
- API/domain/client regression checks, strict app/API types, and a clean API
  build passed before packaging. Production dependencies were installed from
  the API lockfile into an isolated staging directory; no local settings or
  credentials were packaged. Temporary staging and ZIP files were removed.
- Authenticated SCM status confirmed status `4`, `complete: true`, and
  `active: true` for the new deployment. HTTP and account-deletion timer
  functions are registered.
- Post-deployment checks: health returned `200`; unauthenticated summary and
  tournament requests returned `401`; a random nonexistent deletion receipt
  returned `404 deletion_not_found`, confirming read-only runtime SQL connectivity.
- No migrations, settings, secrets, firewall rules, or real player data were
  changed. Live SQL fixture suites and signed-in iPhone tournament creation were
  not run during this deployment. Reload the updated app before using the new format.

### Group-admin development rollout: 2026-10-24 UTC

- Migration `009_group_admins.sql` was applied transactionally to `dinknpc` on
  `sql-dinknpc-3h7pnuwcmrvww.database.windows.net`. The new column was verified as
  non-null `bit`, with `DF_GroupMemberIsAdmin` defaulting to `0`; the runtime
  database user successfully read the column. Only migration 009 was executed:
  no guest-name normalization, creator backfill, existing admin grants, or
  synthetic fixture writes were performed.
- Successful API deployment: `eca2f808-2f84-4bc1-9f96-dc17eae2f7f5`,
  completed at `2026-10-24T03:42:33.8630952Z`, replacing the rotating-only deployment
  above. The target remains `func-dinknpc-3h7pnuwcmrvww` in `rg-dinknpc-dev`,
  running Node.js 24.
- Before upload, 71 targeted role/domain/API/client regressions, strict app/API
  types, and a clean API build passed. Locked production dependencies were
  installed into isolated staging. The ZIP was verified to contain the new
  role implementation, runtime entry point, and rotating modules, without local
  settings or environment files.
  ZIP SHA256: `6104768FB81CB8251C29AD75FDBF8CF55938A1286167830B4F9D8362B95EF9FC`.
- Authenticated SCM confirmed the new deployment ID, status `4`,
  `complete: true`, and `active: true`. Both HTTP and account-deletion timer
  functions are registered. Health returned `200`; unauthenticated summary,
  tournament, and admin-change requests returned `401`. A random nonexistent
  deletion receipt returned `404 deletion_not_found`, verifying read-only
  runtime SQL connectivity.
- No application settings, secrets, firewall rules, hosting tiers, or dependency
  versions were changed. Existing workstation SQL access was sufficient.
  Temporary staging, the archive, and the migration helper were removed.
  Live SQL fixture suites and signed-in iPhone role flows were not run.
  Reload the updated Expo app to use creator enrollment and admin controls.
- Packaging reported two high-severity npm findings for the same underlying
  [MSAL authorization-code advisory](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5):
  locked `@azure/msal-node` 6.0.1 and its parent `@azure/identity` 4.14.0.
  The advisory concerns MSAL's authorization-code flow, which this API does not
  implement; SQL uses Azure default credentials with the configured managed identity,
  and user authentication uses Supabase. Dependency remediation remains follow-up
  work; no forced downgrade or breaking dependency change was included in this rollout.

### DinkNow API rebuild: 2026-10-24 UTC

- Active successful deployment: `43b2ee6a-b084-4334-86ac-fb4bb4b27fb3`,
  completed at `2026-10-24T17:26:43.3326587Z`. The existing Function App,
  runtime, database, routes, and resource identities remain unchanged.
- Rebuilt the current `dinknow-api` package after 44 API/store/script tests
  and strict app/API type checks passed. An isolated, locked production package
  was verified before upload, without local settings or credentials.
  ZIP SHA256: `FA42E60235872D83C74F391D5AC46580BD658200819A17218B68B164CEE6B0E7`.
- SCM confirmed the new deployment ID, status `4`, `complete: true`, and
  `active: true`; HTTP and account-deletion timer functions remain registered.
  Health returned `200`; unauthenticated summaries, tournaments, and admin
  changes returned `401`; a random nonexistent deletion receipt returned
  `404 deletion_not_found`, confirming runtime SQL connectivity.
- No additional migration, settings/secret change, firewall change, data write,
  or dependency upgrade was included. The existing two MSAL-related production
  dependency findings above remain. Temporary staging and the ZIP were removed.
- This API deployment does not install the native iPhone app or update its
  home-screen icon. The separately configured EAS development build is covered
  in [development instructions](../README.md#signed-iphone-development-build).

### Pool-round enforcement rollout: 2026-10-27 UTC

- With explicit user approval, deployment `8afbccb9-03cc-4e84-902c-49e7257af52d`
  replaced `43b2ee6a-b084-4334-86ac-fb4bb4b27fb3` in the same Function App.
  Authenticated SCM independently reported status `4`, `complete: true`,
  `active: true`, and completion at `2026-10-27T15:45:41.2284821Z`.
- Shared domain validation now rejects new scores in later pool rounds until
  every game in earlier rounds is complete, including owner/admin requests.
  Historical later-round results remain readable; clearing earlier results
  re-locks unfinished later games without deleting saved results.
  The existing serializable SQL transition and generic-route bypass protection
  remain in place. See [round progression](tournaments.md#round-progression-and-your-game).
- Before upload, 85 focused domain/API/client/layout tests, strict app/API
  types, and the API build passed. The actual staged compiled domain module
  rejected a synthetic future-round score. The 20,867,625-byte ZIP contained
  8,362 entries with compiled API/shared-domain code and locked production
  dependencies, without local settings or credentials.
  ZIP SHA256: `1658B0BABF15DFCCEF4FDE207B51487BC879E73EF89D146E8666D6E59D5BB269`.
- All 12 application settings matched their pre-deployment SHA256 fingerprints,
  including the account-deletion worker secret. Values were neither printed nor
  saved. HTTP and account-deletion timer functions remain registered.
  Health returned `200`, unauthenticated groups returned `401 unauthorized`,
  and a random nonexistent receipt returned `404 deletion_not_found`, exercising
  the deployed managed-identity SQL connection without modifying data.
- No migration, settings/secret change, firewall change, hosting-tier change,
  or dependency upgrade was included. The two existing production dependency
  advisories remain. Optional SCM file readback returned `404`, so a deployed-file
  byte comparison was not available; the rollout was verified using the tested
  package, active deployment identity/status, and runtime probes.
- Live SQL fixture suites and authenticated live scoring writes were not run.
  Component smoke checks and the served Expo iOS bundle verified the new UI
  code, not native rendering or touch behavior. The separately uploaded
  TestFlight 1.0.1 (3) contains the earlier History changes, not this tournament UI.
- Generated deployment staging, the ZIP, setting-fingerprint baseline, and
  component smoke harness were removed after verification. Normal compiled
  output and the running Expo Go LAN server were retained.

### Current display-name rollout: 2026-10-27 UTC

- With explicit user approval, deployment `13f12275-346c-483e-acfc-130c8f3df856`
  replaced `8afbccb9-03cc-4e84-902c-49e7257af52d` in the same Function App.
  Authenticated SCM independently confirmed status `4`, `complete: true`,
  `active: true`, and completion at `2026-10-27T16:47:43.8697943Z`.
- Shared roster reads now select current registered names from
  `Players.display_name`, retaining membership labels for guests and anonymous
  participants. Existing group/game/tournament IDs, results, ranks, permissions,
  group revisions, and stored membership snapshots are not rewritten.
  No migration, backfill, hosting change, or new endpoint was needed.
- Across targeted runs, 142 profile/cache/store/auth/API/domain/layout tests passed.
  Strict app/API types and the API build passed. All three SQL-store mock
  regressions were also run against the actual compiled staging module and its
  production dependencies before upload, including the current-name projection.
  These are not live SQL integration tests.
- The verified ZIP contained 8,362 entries and was 20,867,773 bytes.
  ZIP SHA256: `E17753CF46085E4F667198B124DD916AF5809D392FACA79A924F52ED195F7F96`.
  Runtime files were checked; no local settings or signing files were included.
  The two existing high-severity production dependency advisories remain.
- All 12 application settings matched their pre-deployment fingerprints,
  including the deletion-worker secret; values were not printed or saved.
  HTTP and account-deletion worker functions remain registered. Health returned
  `200`, unauthenticated groups returned `401 unauthorized`, and a random receipt
  returned `404 deletion_not_found`, confirming read-only managed-identity SQL access.
- The updated Expo Go client confirms name synchronization, protects confirmed
  names/avatars against older responses, and refreshes tournament labels even
  at unchanged game revisions. Component checks cover setup drafts, current
  names, compact tournament scores, readiness/personal cues, and the moved
  playoff-seed confirmation tile. The served iOS bundle was checked separately.
  Automated live account/name writes and live SQL fixture suites were not run.
  After Metro stalled on bundle requests, only the identified workspace Expo
  process was restarted. The full served iOS bundle then contained the new
  confirmation tile, statuses, and name fix, without the former Pool button.
  The user confirmed their own name is correct in Expo Go player selectors after
  reloading. Broader native layout/interaction acceptance remains pending.
  Generated staging, the ZIP, fingerprints, and the smoke harness were removed.
  These client changes are not in TestFlight 1.0.1 (3).

### Measurements

- Expo development builds log `[group-load]` for summary, single-group, and
  full-statistics reads: total duration, local session retrieval, request/body
  download, JSON parsing/validation, status, and response character count.
  `initial-group-commit` measures from mounting the authenticated workspace to
  committing the first successful group list, **not native first-paint time**.
  These client diagnostics are off in release builds.
- With explicit approval, set server-only `DINKNPC_PERFORMANCE_LOGS=true` to log
  authentication (including provider/player lookup), SQL connection, profile
  synchronization, SQL read, total handler time, and UTF-8 response bytes.
  These logs contain only fixed operation labels, status, durations, and sizes:
  no tokens, user/group IDs, names, request bodies, or result data. This setting
  is off by default and has not been configured in Azure.
- Compare the same account/dataset on the same device/network before and after
  rollout: initial summary request, opening one group, and first Stats visit.
  Record several warm runs and a run after at least an hour of inactivity.
  Check actual group tiles and interactions on an installed iPhone build, not
  only Expo Go or synthetic component checks. Request counts should be one
  summary read and zero full-list/detail reads at initial Home startup.
- The development SQL database uses provisioned Standard S0 as of 2026-10-26
  and no longer auto-pauses. Functions still has no configured always-ready
  instance. Handler timings do not include platform startup before the handler
  runs. Compare client request time against server timings before attributing
  the delay to SQL or Functions. Changing hosting capacity or keeping Functions
  warm requires separate approval; do not introduce periodic keep-alive traffic.

Local tests cover summary shape/counts, legacy compatibility, errors,
account isolation, stale responses, removal/rejoin, and concurrent saves.
A 1,000-game synthetic fixture asserts a summary payload at least 95% smaller
than its full history; this is not a claim of measured device latency improvement.
SQL query unit tests use a mocked driver; the live group-options suite also
checks summary/detail count agreement, access filtering, pending-game exclusion,
and deletion recalculation. That suite passed against the approved migrated
development database during the rollout above.

## Account lifecycle setup

**Development schema and API deployed on 2026-10-23.** A read-only beta preflight
on 2026-10-24 confirmed a nonempty server-only Supabase administrative key is
already configured; the check did not print or change its value. Provider/worker
verification is separate from that configuration check. The user subsequently
confirmed disposable-account deletion completes in TestFlight 1.0.0 (2) and
subsequent sign-in is rejected. Full shared-history, ownership, interruption,
and retry acceptance remains pending. Do not run these steps against another
environment or change provider-deletion configuration without separate approval. No new
service or dependency is introduced: the worker uses the existing Functions app and SQL.

1. Apply the additive [008 migration](../api/sql/008_account_lifecycle.sql) with the
   migration runner. It adds `Players.is_deleted`, `GroupLifecycleMutations`, and
   `AccountDeletions`, without anonymizing or deleting existing data.
   The runner updates narrowly scoped table grants for the existing runtime user.
2. In Supabase, create/select a server secret key for the **same project** used by
   the API's `SUPABASE_URL`. Set `SUPABASE_SECRET_KEY` securely in the Azure
   Function app's server-side application settings or a Key Vault reference.
   Never place it in Expo `EXPO_PUBLIC_` settings, source, a command history,
   `.vscode/mcp.json`, deployment archives, or chat. A publishable key cannot
   authorize deletion. Missing configuration rejects deletion requests explicitly.
3. Confirm the existing `AzureWebJobsStorage` configuration supports timer
   triggers. The `accountDeletions` timer runs approximately once a minute when
   the Function host is available. It reads at most five queued jobs per pass.
   Do not enable the feature with this worker disabled.
4. After separate approval, run the synthetic SQL suite against development,
   build/package/deploy the API, and test with disposable Supabase accounts.
   SQL tests deliberately do not call the real administrative deletion endpoint.
   Specifically run `node --test api/src/accountLifecycle.sql.test.mjs` with the
   documented development connection variables and `RUN_SQL_INTEGRATION=1`.
5. Monitor retry logs and pending jobs, validate provider key permissions, and
   prove completion before using real accounts. Availability, alerts, backup
   restoration policy, and public retention disclosures remain release blockers.
   Never log admin keys or account-deletion request bodies.

`POST /groups/{id}/owner` accepts `{ playerId }`. `DELETE /groups/{id}` accepts
`{ confirmation: "DELETE" }`. Both require current ownership, `If-Match`, and an
idempotency key. The target must be another verified registered member. Transfers
preserve roster/history and do not force the former owner into membership.
Responses are `{ groupId, action }`, not a group DTO that the caller may no longer
be allowed to read. Replay is checked before current access or target lookup.

Group deletion removes dependent records and group-scoped guest/anonymous
participants, not registered accounts. Existing mutation receipts are retired
into `GroupLifecycleMutations` before deleting their foreign-key targets. Retrying
an old creation request after deletion returns an explicit gone response instead
of creating another group. Lifecycle acknowledgements remain replayable after
the group disappears. Account deletion later removes that actor's receipts.

`DELETE /me` accepts `{ confirmation: "DELETE" }` with a newly password-confirmed
bearer token and idempotency key. It never accepts a different target account ID.
A serializable transaction rejects unresolved ownership, removes unused
memberships, replaces historical participants with new per-group anonymous IDs,
rewrites tournament team references, removes profile/snapshots/requests/actor
receipts, and inserts a durable deletion job. All authenticated store transactions
and profile synchronization check the deletion block so preauthenticated in-flight
requests cannot recreate an erased account or gain access.

The worker hard-deletes the queued Supabase user, then clears the job's raw
account UUID and records completion. Confirmed `user_not_found` is an idempotent
success; generic 404s, invalid responses, and outages are not. A lost completion
write is safe to retry. Failures remain pending with a retry indicator; attempts
are ordered to avoid repeatedly failing jobs starving newer jobs.

`GET /account-deletions/{receipt}` is public by unguessable receipt and returns
only `{ id, status: "pending" | "completed", retrying }`. It deliberately works
without a deleted account's session. Raw account UUIDs, names, hashes, and group
IDs are never returned. The phone generates a cryptographically random receipt
request ID and reuses it to resolve uncertain responses.

Completed jobs retain a one-way account-ID hash, receipt, and operational timing
metadata to reject stale writes. These records have no mapping to the new
anonymous participant IDs. The runtime cannot delete the blocking table's rows.
This security metadata, existing cloud logs/backups, retention, and restore
procedures must be accurately disclosed and approved before public release.
Database restoration must not resurrect deleted accounts or their identities.

## Group currency and avatars

Run the additive, idempotent `007_group_options.sql` migration before deploying
the matching API/client. Existing groups receive `currency = 'money'` and
`avatar = 'paddles'`. No scores, wager integers, timestamps, players, or tournament
documents are rewritten. The legacy SQL currency default remains Money for old
writers; the updated API explicitly inserts None for new groups unless selected otherwise.

`POST /groups` accepts `{ name, currency, avatar }`. Omitted options default to
None and paddles, while null/unsupported values fail validation. Currency is
`none`, `money`, or `boba` and cannot be changed after creation. Group-avatar IDs
come from the separate [group catalog](../src/domain/groupAvatars.ts); SQL check
constraints reject player-avatar IDs. Both selections are included in creation
fingerprints and client retry identity.

Game DTOs/domain models now use `wagerUnits`, and derived standings use `netUnits`.
Money units are integer USD cents; Boba units are whole drinks; None requires zero.
The existing physical `Games.wager_cents` column holds these integer units without
renaming or converting historical data. Always interpret units using the group's
validated currency. New Money wagers require whole-dollar text: $1 minimum, or
zero for no wager; decimal text is rejected even for `1.00`. Money still uses
integer cents internally, preserving previously saved pending/completed wagers
and fractional historical totals without rounding. No migration is needed for
this input rule. Empty/omitted casual amounts become zero. Fractional Boba,
nonzero None wagers, unsafe values/totals, and tournament wagers are rejected.
Tournament creation rejects all wager fields, including legacy `wagerCents`.

`POST /groups/{id}/avatar` accepts `{ avatar }` and requires creator permission,
`If-Match`, and `Idempotency-Key`. It advances the group revision without touching
player profiles, memberships, results, timestamps, or currency. Public search
includes the selected group avatar, but no new member data.

This prototype DTO update requires reloading the matching Expo client after API
deployment; old `wagerCents` responses or missing group options are not silently
interpreted as the new contract. `npm run test:sql --prefix api` verifies option
persistence, defaults, immutable history, discovery, retries, management permissions,
all group-avatar IDs, runtime SQL permissions, and all three currencies using
synthetic fixtures with exact cleanup.

## Development resources and cost controls

The development deployment uses resource group `rg-dinknpc-dev` in **Central US**.
East US and East US 2 rejected SQL provisioning for the selected subscription;
the initial supporting resources were removed and the group was recreated in
Central US with approval.

[The Bicep template](../infra/main.bicep) creates:

- A Node.js 24 Flex Consumption function app with no always-ready instances.
- Azure SQL Standard S0 (10 DTUs), with a 40 GiB data limit, no free offer,
  and no serverless idle or monthly-free-quota auto-pause.
- Managed identity for storage and SQL, with no database password.
- A function-only delegated subnet and SQL service endpoint. SQL has a VNet
  rule for that subnet, not an allow-all-Azure-services firewall rule.
- Private blob containers, disabled storage shared keys, and HTTPS/TLS.
- Application Insights/Log Analytics with sampling, a 0.1 GB daily ingestion
  cap, and 30-day retention.
- A $50 monthly resource-group budget with alerts at 80% ($40) and 100% ($50).

**The budget is an alert, not a hard spending cap.** Standard S0's Central US
public USD retail rate checked on 2026-10-26 was $0.4839/day (approximately
$15/month for the database). Its configured 40 GiB limit is within the tier's
included storage. Functions, storage, logs, SMTP, taxes, and other usage are
additional; this is not a total hosting quote. Subscription-specific rates and
Visual Studio credits may differ, and the remaining credit balance has not
been verified.

The existing Visual Studio subscription's spending limit remains **On**.
Exhausting subscription credit can still interrupt services; fixed-price SQL
does not remove that separate limit. Do not change the subscription offer,
spending limit, or hosting capacity without approval. This remains a development
beta, not an approved public-production subscription. The budget notification
address is supplied at deployment, not committed here.

After outage recovery on 2026-10-26, the user approved raising the monthly
resource-group budget from $25 to $50. Only the budget amount changed; the
notification recipients, percentage thresholds, budget period, and subscription
spending limit were preserved and verified.

Functions can still cold-start. A retryable service error does not mean that
saved groups were erased. `/api/health` deliberately does not query SQL and is
not sufficient to establish database availability.

### October 2026 free-quota outage and recovery

On 2026-10-26, the API returned `503 data_unavailable` because the former
General Purpose serverless database had exhausted its 100,000 free
vCore-seconds for October. Azure paused it at `2026-10-25T01:45:43.653Z` until
the scheduled November 1 allowance renewal. A read-only SQL connection returned
the explicit monthly-free-allowance error; API health still returned 200.

The account-deletion worker queries SQL every minute, including when no jobs
exist. This prevents the former 60-minute idle auto-pause and can consume the
free allowance independently of friend activity. Simply enabling serverless
overages would retain this continuous compute usage. The worker's durable
deletion and retry behavior was preserved rather than disabled or delayed.

After reviewing costs, the user explicitly approved converting the existing
database in place to Standard S0. Azure rejected the initial request to keep
the old 32 GiB limit without changing the database. The successful request
used the next supported size, 40 GiB, within S0's included storage:

```powershell
az sql db update --subscription '<verified-subscription-id>' `
  --resource-group rg-dinknpc-dev --server sql-dinknpc-3h7pnuwcmrvww `
  --name dinknpc --edition Standard --service-objective S0 `
  --use-free-limit false --max-size 42949672960
```

This conversion permanently leaves this database's free offer. It completed
directly, without a separate `BillOverUsage` serverless step. The database and
API endpoints, data, local backup redundancy, identities, firewall rules,
server settings, and deletion schedule were retained. No migrations, API
deployment, or iPhone rebuild were needed. The infrastructure template was
updated and compiled, but the full template was not redeployed; its app-settings
resource must not overwrite separately configured server-only settings.

Verified after conversion:

- Azure reported `Online`, Standard, capacity 10; a direct read-only SQL query
  independently reported service objective `S0`.
- API health returned 200, unauthenticated groups returned 401, and a new random
  deletion-receipt lookup returned the expected `404 deletion_not_found`,
  exercising the deployed API's managed-identity SQL connection without
  mutating app data.
- The subscription spending limit remained On and the monthly resource-group
  budget remained $25 during recovery, before the separately approved increase
  to $50 recorded above.
- The user reopened TestFlight and confirmed groups load normally.
- Nine initial S0 resource samples showed no saturation (maximum sampled
  average CPU 0.55%, data IO 0.2%). This short, light-load observation is not a
  concurrent-user benchmark; monitor capacity as friends begin testing.

The Bicep compilation and application/API TypeScript checks passed. Expo's
compatibility check still reported the same five pre-existing SDK patch
warnings; no dependency versions changed during this infrastructure repair.

References: [Azure SQL free-tier conversion restrictions](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier-faq),
[DTU service tiers](https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-dtu),
and [Azure retail pricing API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

## Rebuild and deploy

Prerequisites: Node.js 24, Azure CLI, Bicep, a Supabase project configured as in
[authentication setup](authentication.md), and rights to provision resources and
configure the database's Entra administrator. Always verify the target subscription.

```powershell
npm ci
npm ci --prefix api
npm test
npm run typecheck
npm run build --prefix api
az bicep build --file .\infra\main.bicep
```

Sign in with `az login` (or `az login --use-device-code`). Register
`Microsoft.App` for Flex VNet integration before provisioning:

```powershell
$subscription = '<subscription-id>'
az provider register --subscription $subscription --namespace Microsoft.App --wait
az group create --subscription $subscription --name rg-dinknpc-dev --location centralus
```

Deploy the template with these required parameters:

| Parameter | Value |
| --- | --- |
| `adminObjectId` | Entra object ID of the database deployment administrator |
| `adminLogin` | That administrator's principal name |
| `budgetEmail` | Address for cost alerts; do not commit it |
| `supabaseUrl` | Supabase Project URL |
| `supabasePublishableKey` | Public `sb_publishable_...` key, never a service-role key |

The active Azure CLI tenant used for administrator lookup must match the
subscription tenant. `az ad signed-in-user show` supplies the administrator's
object ID and principal name. Use `az deployment group create` with
`--template-file .\infra\main.bicep`, `--resource-group rg-dinknpc-dev`,
`--subscription $subscription`, and those parameters.

Read the resulting hostnames and identity IDs without retrieving credentials:

```powershell
az deployment group show --subscription $subscription --resource-group rg-dinknpc-dev --name dinknpc-foundation --query properties.outputs
```

### Schema and runtime permissions

For initial schema setup, temporarily allow only the administrator workstation's
current public IP in the SQL firewall. Never open `0.0.0.0` or a broad IP range.
The runtime uses the VNet rule and managed identity, not that bootstrap rule.

Set the following process environment variables from the deployment outputs:
`AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_TENANT_ID`, and
`API_IDENTITY_CLIENT_ID` (the `apiIdentityClientId` output). No SQL password or
access token is stored in a file.

For an existing deployment, get the client ID with:

```powershell
az identity show --subscription $subscription --resource-group rg-dinknpc-dev --name '<api-identity-name>' --query clientId --output tsv
```

The SQL application user's SID must use the managed identity's **client ID**.
The **object/principal ID** is used for Azure RBAC role assignments instead.
Do not substitute the object ID in the SQL migration; doing so can cause
`ELOGIN` / SQL error 18456 (state 5). The migration rejects a mismatched existing
user rather than silently replacing its permissions. Review and repair that
dedicated user's mapping transactionally without modifying application rows.

```powershell
npm run migrate --prefix api
```

The migration uses the signed-in Azure CLI credential, enables snapshot
isolation, creates the schema transactionally, and grants the runtime identity
only the table operations it needs. It does not grant schema administration or
database-owner membership. Identity changes require explicit review rather
than silently repointing an existing database principal.

For the real database regression test, use only the approved development database:

```powershell
$env:RUN_SQL_INTEGRATION = '1'
npm run test:sql --prefix api
```

The test rejects preexisting synthetic fixture IDs, creates its own records,
checks creator/member isolation, independent SQL connections, concurrent
writes, replay protection, and deletion recalculation, then deletes only those
test records. It does not create Supabase accounts or send email.

**Remove the temporary workstation firewall rule after migration and tests.**
Keep the function subnet rule. Repeat temporary access only for future approved
database administration.

### Function code package

Build before packaging. Use a fresh, ignored `api\deploy` staging directory and
`api\deploy.zip`; remove only your previous generated outputs if rebuilding.

```powershell
New-Item -ItemType Directory -Path .\api\deploy
Copy-Item -LiteralPath .\api\package.json,.\api\package-lock.json,.\api\host.json -Destination .\api\deploy
Copy-Item -LiteralPath .\api\dist -Destination .\api\deploy\dist -Recurse
npm ci --omit=dev --prefix .\api\deploy
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
  (Resolve-Path .\api\deploy).Path,
  (Join-Path (Get-Location).Path 'api\deploy.zip'),
  [IO.Compression.CompressionLevel]::Fastest,
  $false
)
az functionapp deployment source config-zip --subscription $subscription --resource-group rg-dinknpc-dev --name '<function-app-name>' --src .\api\deploy.zip --build-remote false
```

Verify the active deployment directly through authenticated SCM, without
retrieving or printing publishing credentials:

```powershell
az rest --method get --url 'https://<function-app-name>.scm.azurewebsites.net/api/deployments/latest' --resource 'https://management.azure.com/' --query '{id:id,status:status,complete:complete,active:active,end_time:end_time}'
```

Require the new deployment ID, status `4`, `complete: true`, and `active: true`,
then check HTTP health and authorization separately. A successful upload exit
code or empty/null CLI status fields alone are not deployment verification.

Do not package `.env`, local Azure credentials, SQL access tokens, or source
control state. The staged app contains compiled API/shared-domain code, host
configuration, and production dependencies. Remove the generated staging/ZIP
after deployment.

Set `EXPO_PUBLIC_API_URL` in the app's ignored `.env` to the deployment's HTTPS
`apiUrl` output, including `/api`. Keep the existing Supabase public settings.
Restart Metro **without CI mode** and reload Expo Go after changing this URL.

## HTTP contract

All account/group data endpoints require a Supabase bearer token. Process health
and non-identifying deletion-receipt status are public. No function key, SQL
credential, or administrator key is embedded in the phone.

The [tournament feature](tournaments.md) uses the additive `003_tournaments.sql`
migration. Tournament creation/management requires an owner or admin; members can score
ready matches using tournament-specific endpoints. Generic game endpoints
reject linked tournament games so targets, advancement, and correction rules
cannot be bypassed. The migration leaves existing games untagged and unchanged.

The additive `004_player_avatars.sql` migration adds a constrained avatar ID to
`Players`, defaulting existing rows to `smile`. Apply the Supabase avatar lookup
migration described in [authentication setup](authentication.md), run the Azure
migrations, then deploy the API before testing avatar saves.
Roster reads join each member to the current player avatar rather than taking
an avatar snapshot. Registered names likewise use `Players.display_name`, not
the join-time membership snapshot; guest and anonymous labels retain their saved
group-local names. This updates old game presentation without rewriting games,
name snapshots, standings, group revisions, or permission rules. Name changes
need this API code deployed, not a migration or data backfill. No email column
or additional runtime permissions are introduced. The SQL regression suite
checks cross-group refresh, unchanged completed games/rankings, default reset,
invalid-avatar constraints, and independent-connection reads.

The additive `005_activity_timestamps.sql` migration adds nullable game
`created_at` and `completed_at` columns. Existing game rows remain unknown;
the creation default applies to future inserts only (no `WITH VALUES` backfill).
New game creation and result completion use `SYSUTCDATETIME()` inside the write
transaction. Clearing a result clears completion time without changing creation
time. Idempotent retries return existing times rather than restamping a result.
Run migrations before deploying the updated API. No new permissions are needed.

Responses expose optional/nullable `createdAt` and `completedAt` as canonical
UTC ISO timestamps. The client accepts absent fields from older API versions,
explicitly displays **Time unavailable** for unknown historical dates, and
rejects malformed/inconsistent timestamp data. Tournament creation uses its
existing SQL `created_at`; completion is derived from the championship game's
completion time, never from the last refresh or an unrelated game.
These metadata values are not accepted from client mutation payloads or stored
redundantly in the tournament schedule JSON. The SQL regression tests cover
durability, replay stability, historical nulls, and clear/rescore/reset behavior.

The additive `006_guest_players.sql` migration adds `Players.is_guest`, defaulting
all existing records to registered accounts. Apply it before deploying the API.
**POST /groups/{id}/guests** accepts only the guest name as meaningful input and
requires the authenticated group creator plus an idempotency key, but no
`If-Match`. The server generates a fresh UUID after replay checks and inserts
a new guest and roster row atomically. Existing guest IDs cannot be reused via
account lookup or profile synchronization, so records stay scoped to their
original group. Guests confer no login, ownership, membership access, or editing
rights. Their wins, losses, differential, shared ranks, and simulated balances
use the existing game logic unchanged.

Roster responses include `isGuest: true` for guests and `isDeleted: true` for
historical anonymous participants. Active registered participants have neither
flag. Invalid flag types or noncanonical anonymous names/avatars are
rejected by the client. Names are saved
without **(g)**; shared display helpers add it, including duplicate-name IDs.
Public player counts include guests. Guest creation does not contact Supabase
to create accounts or send messages. SQL tests use synthetic fixtures and
clean up only guest records belonging to their explicitly created test groups.

Guest names are checked case-insensitively after trimming, among that group's
guests only. The check and insert share the serializable group lock, including
when concurrent requests use different idempotency keys. `migrate` also runs
the idempotent `guestNames.mjs` repair: it retains the earliest roster entry's
name and gives later duplicates unused numeric suffixes, updating the saved
name and snapshot and bumping only changed group revisions. It does not alter
player IDs, games, tournament documents, or statistics.

`DELETE /groups/{id}/players/{playerId}` requires the creator, `If-Match`, and
an idempotency key. The locked transaction checks all game and tournament
references, removes the roster entry, compacts positions, and deletes the
`Players` row only for a group-local guest or an unused anonymous participant.
Registered accounts and other groups remain
untouched. Group deletion follows the separate lifecycle operation; guests are created only
inside an existing group's transaction and cannot be reused across groups.
Run `migrate` before deployment to grant the runtime identity scoped
`UPDATE, DELETE` on `GroupMembers` and `DELETE` on `Players`. No new schema
columns are required. Run it again after deployment to catch legacy duplicates
created by the old API during rollout. SQL checks cover these actual runtime
permissions, name collisions, physical guest deletion, replay, account retention,
position reuse, history protection, and identity-preserving duplicate repair.

| Method/path (under `/api`) | Access |
| --- | --- |
| `GET /health` | Public process health; not proof of database access |
| `GET /me` | Verified current player's durable record |
| `DELETE /me` | Current account; recent password proof, confirmation, idempotency key, no owned groups |
| `GET /account-deletions/{receipt}` | Public non-identifying receipt status |
| `GET /groups` | Only groups created by or containing the caller |
| `GET /groups?view=summary` | Same owner/member access; metadata and counts only |
| `POST /groups` | Verified caller creates a group |
| `GET /groups/{id}` | Creator or added member |
| `POST /groups/{id}/owner` | Current owner; transfer to eligible registered member |
| `DELETE /groups/{id}` | Current owner; explicit permanent deletion |
| `GET /groups/search?query=...&cursor=...` | Verified user; public metadata only |
| `PUT /groups/{id}/join-requests/me` | Caller requests membership in a public group; idempotency key required |
| `GET /groups/{id}/join-requests` | Owner/admin only |
| `POST /groups/{id}/join-requests/{playerId}` | Owner/admin; approve or decline a pending request |
| `POST /groups/{id}/visibility` | Owner/admin; explicit public/private change |
| `POST /groups/{id}/players` | Creator or member; exact player code or legacy UUID, verified account required |
| `POST /groups/{id}/guests` | Owner/admin; unique guest name, idempotency key required |
| `POST /groups/{id}/players/{playerId}/admin` | Owner/admin; change another registered member's admin access |
| `DELETE /groups/{id}/players/{playerId}` | Owner/admin; unused player, revision and idempotency key required |
| `POST /groups/{id}/games` | Creator or member; distinct doubles teams and wager |
| `POST /groups/{id}/games/{gameId}/result` | Creator or member; one final result |
| `DELETE /groups/{id}/games/{gameId}` | Owner/admin; cancellation or result deletion |

Errors use `{ "error": { "code": "...", "message": "..." } }`. Invalid input,
missing login, forbidden writes, stale versions, and unavailable data services
are explicit non-success responses. Private responses are not cacheable.
The runtime logs diagnostic categories/correlation IDs, not tokens, passwords,
request bodies, or complete account objects.

## Device acceptance checks

1. Log in, create a group, and verify automatic creator enrollment. Use
   **Settings > Copy player code** to join another member's group after the code
   rollout. Verify exact six-character copy, lowercase input and legacy UUID
   compatibility, duplicate-account rejection, and explicit unavailable/copy errors.
2. Fully reload, then sign out and log in again. The group and player must return.
3. With four verified accounts, start and complete a doubles game. Reload and
   verify the result, shared ranks, and zero-sum simulated net.
4. Log in as a member on another device and verify add/start/score actions.
   Game deletion, visibility, and request review require an owner/admin; group
   deletion and transfer require the owner. An unrelated
   user must not see private groups or public rosters/results before joining.
5. Edit the same group from two creator sessions: stale writes must prompt a
   refresh. Retry a simulated interrupted save without changing its inputs and
   verify it does not create a duplicate.
6. Delete a result, reload, and confirm its standings effects remain removed.
7. Exercise public search, duplicate requests, declines/resubmissions, private
   transitions with pending requests, and creator approvals across two accounts.

Unit tests, SQL tests, and an iOS JavaScript export do not substitute for native
UI, session-storage, network interruption, or multi-device testing. Configure
custom SMTP before inviting arbitrary new accounts. Lifecycle schema and API
are deployed to development, but still need provider configuration, operational
worker verification with disposable accounts, and native acceptance.
Offline writes, push updates, and production abuse controls
remain outside this slice.
