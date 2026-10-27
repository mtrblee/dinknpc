# DinkNow

An iPhone app for tracking pickleball scores and individual rankings within
groups of friends.

The Expo slug is `dinknow`; the local npm packages are `dinknow` and `dinknow-api`.
This is a branding-only rename. The repository and local folder, Azure/Supabase
resources, backend function/SQL identities, and environment-variable names
remain unchanged. Internal authentication storage keys and account-deletion
hash namespaces retain their legacy identifiers for compatibility.
No database migration or API deployment is needed for the rename.
Expo Go may treat the new slug as a separate project; sign in again if prompted.
Saved accounts, groups, and results remain in the existing backend.

The interface uses burnt-orange branding, warm cream backgrounds, dark-brown
text, and peach highlights, with distinct score, error, and leader accents.

Six-character shareable player codes are implemented, and the approved
[migration 010 and API rollout](docs/azure.md#six-character-player-codes) are
deployed to development. Reload Expo Go and open **Settings > Copy player code**.
Internal UUIDs and previously shared full IDs remain valid. No native build
has been released for this change; TestFlight 1.0.1 (3) still has the old ID UI.

The approved DinkNow logo is a rounded **D** with three pickleball-inspired
cutouts. Artwork is available as a [scalable SVG](assets/branding/dinknow-logo.svg),
[transparent 1024px PNG](assets/branding/dinknow-logo.png), and
[opaque 1024px app icon](assets/branding/dinknow-app-icon.png).
See the [design preview](assets/branding/dinknow-logo-preview.png).
The artwork is configured as the Expo app icon, Android adaptive/themed icons,
and web favicon. Android layers include transparent padding for launcher masks.
Home-screen icon changes require a new native build; Expo Go's own installed
icon does not change.

The current prototype supports creating groups, adding players, setting up
doubles games with optional simulated per-player wagers, recording results, and
viewing individual standings and game history. Each group also has a dedicated
leaderboard page with shared-leader highlights and player stat cards.
It does not process real money.

Choose **None** (the default), **Money**, or **Boba** when creating a group.
New Money wagers use whole USD dollars only: $1 minimum, or 0 for no wager.
Decimal input is not allowed. Amounts remain stored as integer cents so existing
wagers and totals keep their exact values. Boba uses whole drinks. Blank amounts mean zero.
None hides wagers and simulated net; tournaments remain wager-free in every group.
Existing groups retain Money and their historical totals. Standings use light
green for positive net/point differential, light red for negative, and neutral for zero.
Each group also has its own emoji avatar from a separate 12-choice collection,
selected at creation or changed by its owner or an admin in **Group settings**.
Group avatars appear on Home, group tiles, public search, individual statistics,
and group/leaderboard headers. Existing groups start with the paddles avatar;
player avatars are independent.

Group owners and admins can also run **2-8 fixed-team round-robin tournaments** with
seeded single-elimination playoffs. Choose one game to 11 or 15 separately for
round robin and playoffs. The championship can be one game to 11, one to 15,
or best two of three games to 11. Every game is win by two with no cap, and each
played game counts separately toward group standings. See [tournament setup and rules](docs/tournaments.md).
Alternatively, choose **Rotating partners** for exactly **4 or 8 players**.
Everyone partners with everyone else once: 3 games for four players or 14 for
eight. Choose one game to 11 or 15, win by two with no cap, with no playoffs or wagers.
Individual ranks use wins, then point differential; exact ties share ranks.
Overview, Standings, and Schedule tabs include all tied leaders in final results.
Existing tournaments keep their saved rules; legacy defaults are pool/rotating to
11 and playoff/championship to 15. New configurable scoring requires
[migration 011 and the updated API](docs/azure.md#configurable-tournament-scoring).
That approved development rollout is in progress. No new TestFlight build is included.
The tournament directory has a top **Create tournament** tile and
two-column **In progress** / **Completed** sections. Tap any tournament tile to
open it. Fixed tournaments complete after the championship; rotating tournaments
complete after every scheduled game.

Users sign up and log in with **Supabase Auth**, including email-code
verification. **Groups, player records, memberships, and games persist in Azure
SQL Database through an Azure Functions API.** Saved data remains after sign-out
or app restart. Creators and added registered members can view a group across devices;
members can add registered players, start games, and record scores. Owners and admins can
cancel/delete games, change visibility, and review join requests.
New groups automatically add their creator as a player. Existing rosters stay unchanged.
Owners and admins can promote/demote other registered players in **Group settings > Admins**.
Only owners can delete groups or transfer ownership. Admin groups remain in **Groups you joined**.
Migration **009** and the role-enabled API are deployed to development.
Reload the updated Expo app. Other environments require migration 009 before
the API deployment; update clients together with that rollout.
Add registered players using their verified account IDs. For people without
accounts, the owner or an admin uses **View players > Add a guest player**, below
**Add a player**. Guest names must be unique among guests in that group
(ignoring case and outer spaces); other groups can reuse the same names.
Guests are saved on that group's
roster, use the default emoji, and appear as **(g) Name** throughout the app.
They count toward the same standings and simulated totals, but cannot log in
or gain group access. Guest records are not automatically linked to later accounts.
The owner and admins can remove unused players with the roster's remove icon.
Removal deletes a guest record, but only the group membership for a registered
player. Players appearing in any game or tournament cannot be removed.
**Group settings > View players** opens a compact roster table with a
blank avatar header and **Name** column, plus the member-accessible add-player
form. Account emails are not shown.
Choose an account-wide emoji in **Settings > Change avatar**; players who have
not chosen one use a smiling face. Completed games use two team rows with
avatars, names, scores, a highlighted winner, simulated wager, and a
casual/tournament label. History cards are narrower and centered, with smaller
regular-weight scores and a soft sage-green highlight only behind the winning
team's players. Team tables show each player on their own line with their avatar.
Pool standings also stack teammates. Pool and playoff cards use the same plain
completed scores and sage-green winner styling. Pool schedules have numbered
round sections; all games in the current round must finish before anyone,
including owners/admins, can score a later round. A blue **Your current game**
cue identifies the signed-in player's unfinished playable match.
In-progress casual and tournament games let members enter scores directly in
the team rows, with a single save button below. Player choices for casual games
and fixed tournament teams also show their avatars. Pool standings use a
compact ranked table with a blank rank header followed by **name**, **w**, **l**,
and **+/-**. Each casual team and tournament player selection use the same
compact two-column grid, smaller names/avatars, and tighter spacing, retaining
44-point touch targets. Full names and duplicate-name IDs remain readable.
The **How it works** guide is at the top of **Create a group**, above the styled setup form, rather than Home.
Team names use `/` separators and winning score rows are highlighted.
Tournament details open on **Overview**, followed by **Pool**, **Pool Games**,
and **Playoff**. The read-only Overview contains format, timestamps, standings
rules, schedule information, and bracket guidance. An **In progress** banner
above the tabs becomes a gold-and-silver **Champions** banner showing **1st**
and **2nd place** after the championship result is saved. Clearing the final or
resetting playoffs restores In progress. Switch between information, standings,
the pool schedule, and the left-to-right bracket without losing score drafts.
Tap a bracket match to enter its scores.

Game cards and tournament tiles/details display their creation time while in
progress and their completion time after the result is saved. Timestamps are
server-saved UTC instants displayed in the device's local time zone. Historical
dates that were never recorded show **Time unavailable**; no dates are guessed.

Home explains the core workflow: create a group for your pickleball crew,
add players, then keep scores and standings together. Its primary **Create a
group** button opens the form directly. **Your groups** previews up to three
saved groups with player/completed-game counts, the latest recorded completion
date, and a **View all groups** link. Home sorts by the newest completed-game
timestamp before choosing those three. Undated/no-game groups follow dated
groups; ties retain the existing order.
A three-step guide explains the workflow, with search and individual statistics
as secondary actions. Empty accounts receive create/join guidance.

The Groups tab starts with **Create a new group**, which opens a separate
creation page. **Groups you own** appears first, followed by **Groups you joined**.
Each section shows colored, square-style avatar tiles with the same activity
date in two columns, with its
own empty-state guidance. Owned groups appear only in the first section, even
when the creator is also a player. Tiles omit creator details and leaderboard shortcuts. Open a group
to access its players, games, tournaments, and leaderboard. The workspace
header is removed; small top-left back icons return through the pages while
the bottom navigation remains available. Pressing the bottom **Groups** tab
always opens this main list, even when already viewing a group. It clears the
active group, tournament and leaderboard and cancels pending automatic opens,
but preserves an unfinished create-group form.
Each group's main page starts with two small **Overview** and **Leaderboard**
tiles. Overview shows a description generated from saved group details and a
read-only current-player roster, including guests. Leaderboard uses compact
standing cards with the same ranks, signed point differences, and simulated totals.
**Game Types** has **Create a single game** (casual doubles) and **Create a
tournament** side by side, two per row. The small **Group settings** button opens
**View players** for all members. Owners and admins also see join requests first, a compact
public/private status, avatar, and admin settings. Group settings matches the compact
general Settings layout: a group avatar/name header followed by divided setting rows.
Public/private status and its icon sit in the list, not beside the header. Each row
opens a separate page; Back returns to the settings list before the group's main page.
Only owners see ownership transfer and group deletion. The admin/owner pickers,
visibility changes, transfer, and deletion keep their existing confirmations; guests and deleted players cannot
receive ownership. **View players** puts compact registered/guest add forms above
the roster, with the input and Add button on one wrapping row. The compact roster
uses smaller avatars, inline role labels and clear, red-outlined **Remove** buttons
for owners/admins, retaining confirmation and history-based removal restrictions.
Both View players and Overview list the owner first, then admins, then regular
players, keeping the existing order within each role without changing the saved roster.
Back from View players returns to settings. **History** stays
at the bottom; tap a completed tournament game itself to open its tournament.
Pull down to refresh lists, players, requests, tournaments, search results,
and leaderboards, including retrying failed loads. There are no refresh buttons.

### Startup data loading

Home and Groups request lightweight group summaries, including player and
completed-game counts and `latestCompletedAt`. This is the latest known completion
time among casual and tournament games, not a pending game's creation or a profile
edit. Dates use the device's locale/time zone. Empty groups show **No completed
games**; historical/older-server responses without dates show **Date unavailable**.
No extra history loads or date backfill are introduced. Opening a group fetches its full roster and history;
Stats fetches full histories only when visited. Hidden screens mount on their
first visit, then retain drafts without recalculating while hidden. The cache
is in memory and belongs only to the signed-in account.

The updated API was deployed to development on 2026-10-23. Older APIs that ignore
`?view=summary` remain compatible: the client validates their full-list response,
derives summaries, and logs a deployment warning. The development API now
supports the smaller payload. Failed responses still surface as errors.
The [completion-date aggregate](docs/azure.md#latest-completed-game-activity)
was deployed to development on 2026-10-27 without a database migration. Reload
Expo Go for the updated Settings, activity dates and Groups-tab navigation;
the existing TestFlight build does not include these UI changes.
See [startup performance measurements](docs/azure.md#startup-performance)
for development timings and the cold/warm-device verification procedure.

See [product rules](docs/product.md) for the approved calculations and scope.
See [authentication setup](docs/authentication.md) to configure your Supabase
project and the local public connection settings.
See [Azure backend setup](docs/azure.md) for deployment, database access, costs,
and the persistence verification checklist.
The existing beta backend uses Azure SQL Standard S0 (approximately $15/month
database-only retail), following the approved 2026-10-26 free-quota outage fix.
Other hosting costs are additional; the $50 budget is an alert, not a cap.
See the [outage and recovery record](docs/azure.md#october-2026-free-quota-outage-and-recovery)
for verification and the unchanged subscription spending limit.

**Public release is not ready yet.** Recovery and account lifecycle code are
implemented; migration 008 and the updated API are deployed to development.
The server-only Supabase key was confirmed present during beta preflight.
The user confirmed non-team email delivery, TestFlight password recovery, and
disposable-account deletion. A signup-template link/code mismatch was corrected;
a fresh signup test, complete lifecycle/device acceptance, privacy/support
information, and signed-build configuration remain open.
See [App Store release readiness](docs/release-readiness.md)
before starting any release build or submission.

## Stack

- React Native 0.88 with Expo SDK 58
- React 19.3 and strict TypeScript
- Supabase Auth with Expo SecureStore for native session storage
- TypeScript Azure Functions (Node.js 24) and Azure SQL Database
- npm with a committed package-lock.json for reproducible dependency installs

The project reports SDK `58.0.0` to Expo Go and uses the Expo `58.0.11` package
patch. Update Expo Go on your iPhone to a version that supports SDK 58 before
opening the project. During an App Store rollout, the available Expo Go version
may still support only SDK 57; in that case, wait for the SDK 58 update or
separately approve a development build. Changing the project's reported SDK
version does not make an older Expo Go compatible.

A navigation framework is not yet selected. Supabase provides
authentication, account display names, and a restricted exact-ID player lookup
used by the Azure API. The leaderboard uses a
built-in React Native full-screen modal, without a navigation dependency.

## Prerequisites

- Node.js 24 LTS and npm
- VS Code or another editor
- Expo Go with SDK 58 support on an iPhone for physical-device testing
- A Supabase project configured for email/password signup and code verification
- A deployed Azure API and database (see [Azure setup](docs/azure.md))

A free Expo account is required for serving this project to Expo Go on a
physical iPhone. Expo CLI and Expo Go must be signed in to the same account.
Expo Go itself does not require a paid Expo plan or cloud build service.
The optional signed iPhone development build below uses EAS and requires an
active Apple Developer membership; build quotas or charges may apply.

## Install and run

After cloning the repository:

```powershell
npm ci
npm ci --prefix api
```

Follow [authentication setup](docs/authentication.md) to populate `.env` from
`.env.example` using the Supabase Project URL, publishable key, and the Azure
API's HTTPS URL (`EXPO_PUBLIC_API_URL`), then:

```powershell
npm start
```

The default development server binds to localhost and cannot be reached from
your iPhone. For a physical iPhone, stop that server, sign in to Expo CLI, and
explicitly enable local-network access:

```powershell
npx expo login
npm run start:device
```

Sign in to Expo Go on your iPhone with the same Expo account, then scan the
terminal QR code with the iPhone camera. GitHub sign-in is separate from Expo
sign-in. Use `npx expo whoami` to check the CLI account; do not put credentials
in source files or chat.

The Expo development account is separate from the DinkNow account created
inside the app. Supabase's default email sender only supports project-team
addresses; custom SMTP is required before other users can register.

Your phone must be able to reach your computer on the same trusted local
network. A computer connected by Ethernet is fine if the network permits
communication with Wi-Fi devices. The LAN server serves development code to
reachable devices, so use it only on a trusted network.

### Signed iPhone development build

The native app is linked to [@dinknpc/dinknow](https://expo.dev/accounts/dinknpc/projects/dinknow)
with iOS bundle identifier `com.dinknpc.dinknow`.
The `development` profile in [eas.json](eas.json) builds a development client
for registered physical iPhones using internal distribution, not a simulator
or App Store submission. It includes the approved DinkNow launcher icon.

Run the **EAS: iPhone development build** VS Code task, or from this directory:

```powershell
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = (Get-Location).Path
npx --yes eas-cli@25.1.1 build --platform ios --profile development
```

Review encryption declarations and complete Apple authentication, 2FA, device
registration, and signing prompts only in the interactive terminal or the
official registration page. Never put passwords, codes, certificates, or keys
in chat or source. Additional iPhones must be registered and included in a new
provisioning profile/build before they can install an internal build.

The no-VCS build mode uploads the current working files without Git metadata;
it does not commit or change repository history. [.easignore](.easignore)
excludes local environment/credential files, backend code, infrastructure,
and unrelated project configuration. Development JavaScript gets its public
Supabase/API settings from the local Metro server's ignored `.env`; these
files are not uploaded to EAS. Standalone release environments still need
separately configured build-time public settings.

Open the completed build's installation page in Safari on the registered
iPhone. Install DinkNow, enable Developer Mode if iOS requests it, and allow
local-network access on your trusted Wi-Fi. Use separate terminals when running
both clients:

```powershell
# Expo Go
npm run start:device -- --port 8081

# The installed DinkNow development build
npm run start:dev-client -- --port 8082
```

Use the matching terminal's QR code. Expo Go and the native development build
are different apps; Expo Go's own home-screen icon does not change.
Rebuild the native app when changing native dependencies or native app configuration.
Ordinary JavaScript changes are served by Metro.

### TestFlight beta for remote friends

The user selected TestFlight instead of a public App Store release. The `beta`
profile builds a standalone iOS app: JavaScript is bundled inside the app, so
testers can use cellular or any Wi-Fi without Expo Go, Metro, or a running
development computer. It retains `com.dinknpc.dinknow` and targets App Store
Connect Apple ID `6826646735`. This is a testing-only beta using the existing
development Azure/Supabase services, not a new production environment.

Unlike the internal `development` profile, `beta` uses store distribution,
disables the development client, and increments the local iOS build number.
Its EAS environment is explicitly `preview`, not `production`. Populate that
project environment with only the approved public connection values:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These values are embedded in the app and are not secrets. Never upload SMTP
credentials, Supabase administrative keys, or local `.env` files. Keep the
no-VCS upload boundary used by the development build:

```powershell
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = (Get-Location).Path
npx --yes eas-cli@25.1.1 build --platform ios --profile beta

# After verifying that this exact beta build finished successfully:
npx --yes eas-cli@25.1.1 submit --platform ios --profile beta --id <verified-beta-build-id>
```

The matching VS Code build/submission tasks use an interactive terminal for
Apple authentication and signing. The submission task asks for the verified
beta build UUID; do not select an internal development build or assume the
latest build is the intended one. Uploading makes a build available for
App Store Connect processing; it does not publish the app or approve external
testing. If a task runner cannot open the build-ID input prompt, run the explicit
submission command above in an interactive terminal with the verified UUID.

The first beta, **1.0.0 (2)**, was built and uploaded successfully on 2026-10-24;
the user confirmed it installs and loads groups over cellular without Wi-Fi. See
[DinkNow TestFlight](https://appstoreconnect.apple.com/apps/6826646735/testflight/ios).
It requires iOS 16.4 or later. Installing it replaces the DinkNow development
build on that device because both share a bundle identifier; Expo Go remains
a separate app. Backend groups are not deleted by changing the installed build.

Friends are external TestFlight testers, not App Store Connect team members.
Complete beta metadata/reviewer access, verify signup/recovery delivery to
non-team email addresses and real account deletion, and test the installed
standalone build before requesting external beta review. After approval,
invite friends through TestFlight. Device UDID registration is not required.
The existing development services retain their usage limits and availability
constraints. TestFlight builds expire and need replacement builds; EAS Update
is not configured.

#### Release version policy

For each newly approved TestFlight or App Store release, advance the public app
version by one patch: **1.0.1, 1.0.2, 1.0.3, ...**, unless another version is
explicitly requested. Keep `expo.version` in `app.json` aligned with
`package.json` and the lockfile's root package versions. Use
`npm version <version> --no-git-tag-version --ignore-scripts` for the npm files
and update `expo.version` to the same value before starting the build.

The public app version is separate from Apple's numeric `ios.buildNumber`.
The EAS `beta` profile's `autoIncrement: true` advances that build number for
each build attempt. Retries or replacement builds for the same release keep
the public app version and receive a new build number; installing an existing
build does not increment either. Version updates do not authorize a build,
submission, commit, tag, or public release on their own.

See [release and beta readiness](docs/release-readiness.md) for current blockers.

### Troubleshooting an iPhone timeout

1. Keep the terminal running and use the QR code from `npm run start:device`,
   not from the localhost-only command.
2. Check the host in the printed `exp://HOST:PORT` URL. It must be a computer
   address reachable from the phone, not `localhost`, `127.0.0.1`, or an
   isolated virtual-machine address.
3. On the iPhone, open `http://HOST:PORT/status` in Safari using that same host
   and port. Metro should respond with `packager-status:running`. If Safari
   also times out, fix network reachability before investigating app code.
4. A VM, remote workstation, guest Wi-Fi, VPN, or network policy may isolate
   the phone from Metro. Prefer running Expo on the physical computer on the
   same trusted network as the phone. Changing the advertised address alone
   does not create a route to an isolated VM.
5. If iOS shows a local-network permission for Expo Go, allow it for your
   trusted network. If this is a managed network, ask its administrator about
   device-to-device access rather than weakening its controls.

Do not disable Windows Firewall, change a public network to private just to
bypass restrictions, forward router ports, or expose Metro through a public
tunnel. A successful Safari status response proves basic reachability, not
Expo account or SDK compatibility; those are separate checks.

### Expo Go shows outdated screens

If Expo Go keeps showing old screens after reloading, check the Metro terminal
for **"Metro is running in CI mode, reloads are disabled."** CI mode disables
file watching, so even a phone reload may receive an outdated bundle. Stop the
server with Ctrl+C, then restart in development mode with a fresh cache:

```powershell
if (Test-Path Env:\CI) { Remove-Item Env:\CI }
npm run start:device -- --clear
```

Reload the app in Expo Go afterward. Saved Azure data remains; unsaved drafts reset.
Use CI mode for automated checks/exports, not interactive device development.

### Other platforms

Windows cannot run Apple's iOS Simulator or compile native iOS builds locally.
On a Mac with Xcode and its simulator installed, use:

```powershell
npm run ios
```

With an Android emulator already installed and running, use:

```powershell
npm run android
```

Web support is not installed in this minimal starter. Expo Go also supports
only a defined set of native capabilities; custom native libraries may require
a development build.

## Checks

```powershell
npm run typecheck
npm test
npm run test:coverage
npx expo install --check
```

Tests use Node.js 24's built-in test runner with TypeScript stripping. The
JavaScript test harness imports pure TypeScript modules directly; no extra test
dependencies are required. Coverage includes group logic, auth validation, and
the auth adapter, not React Native UI or native secure storage. Auth tests mock
provider responses; they do not send email or create real accounts. The
[database regression script](supabase/tests/registered_players.sql) separately
checks lookup eligibility and permissions with rolled-back synthetic fixtures.

### Current validation limitations

As of the development-build setup on October 24, 2026, the installed Expo package is
`58.0.11`, with React Native `0.88.0`, React `19.3.0`, and native modules matching
that Expo package's bundled version map. Expo's online compatibility check
still recommends newer patches:

| Package | Installed | Recommended |
| --- | --- | --- |
| expo | 58.0.11 | ~58.0.19 |
| expo-clipboard | 58.0.3 | ~58.0.4 |
| expo-crypto | 58.0.6 | ~58.0.7 |
| expo-dev-client | 58.0.14 | ~58.0.15 |
| expo-status-bar | 58.0.3 | ~58.0.4 |

Those recommended patches were unavailable from the configured npm feed during
the upgrade. Direct public-registry access also failed with a TLS handshake
error. The online check therefore still exits with a compatibility warning.
When the patches become available, use `npx expo install --fix` and rerun the
checks above. Do not disable TLS verification or suppress the compatibility
check. Matching the bundled version map does not verify native behavior on an
iPhone or the installed Expo Go version.

The latest development-client install reported 13 dependency advisories (5 high, 8 moderate),
including Expo/React Native dependencies. They remain unresolved; do not use
`npm audit fix --force`, which proposes incompatible downgrades. Recheck the
audit when updating the SDK and review compatible fixes before release.

To verify that Metro can produce an iOS JavaScript bundle without Xcode:

```powershell
npx expo export --platform ios --output-dir dist
```

An export is not a signed iOS application and does not verify behavior on an
iPhone. No linter or UI test runner is configured yet.

## Try the prototype

First create and verify a DinkNow account, or log in to an existing account.
Choose your display name when prompted. Apply the registered-player SQL setup
described in [authentication setup](docs/authentication.md#registered-player-lookup).
Use the bottom taskbar to switch between **Home**, **Stats**, **Groups**,
**Search**, and **Settings**. Home prioritizes creating/opening a group, explains
the three-step workflow, and includes secondary search/statistics shortcuts.
Stats shows your group count and personal rank/results separately for each group.
In Settings, use **Change display name**, **Copy player code**, or **Sign out**. Returning
from settings preserves the selected group and unsaved fields.
Settings uses compact profile/action rows, an inline player-code Copy button,
and quieter account actions, retaining 44-point touch targets, wrapping text,
copy/retry feedback and the existing account-deletion confirmation flow.
Display-name saves confirm account storage and Azure synchronization before
reporting success. Current names appear in existing rosters, tournament/casual
selectors, history, standings, and brackets; other devices load them on refresh.
IDs, teams, results, guest labels, and anonymous history stay unchanged.
Use an authorized Supabase test email until custom SMTP is configured. Follow
the [authentication device checklist](docs/authentication.md#verification) to
test session restoration and sign-out before checking group features.

1. From Home, tap **Create a group** and give it a name. Check that backing out
   returns to Home with the draft name preserved; a successful save opens the group.
   Open **View players**, and add four distinct participants using registered
   six-character player codes (legacy full IDs also work) or the owner/admin **Add a guest player** section. Each registered account must have a display
   name; copy your own code using **Settings > Copy player code**. Select saved guests
   during casual and tournament setup; those pages do not create guests.
   Check the **(g)** prefix, per-group name uniqueness, owner/admin creation/removal,
   blocked removal of participants, and preserved setup drafts. Multi-account permission
   testing still requires email delivery for those accounts; guests cannot log in.
2. In the group, follow **Game Types > Create a single game**.
   Select two players on Team A and two on Team B on the dedicated game page.
3. Enter `5.00` as the simulated wager and tap **Start game**.
4. In **In-progress games** on that page, enter final scores of `11` for Team A
   and `7` for Team B, then save. The game should leave this section and appear
   in **History** after tapping the top-left back icon.
5. Each Team A player should have one win, a +4 point differential, and +$5.00
   simulated net. Each Team B player should have one loss, a -4 differential,
   and -$5.00 simulated net.
6. Tap **Leaderboard** near the top of the group page.
   Check the group name, four players, one completed game, and the same stats.
   The two winners should share rank 1 and the leader highlight; the other two
   players should share rank 3.
7. Tap the back icon, then confirm deletion of the result. Reopen the
   leaderboard: all four players should be unranked with zero stats and no
   completed games. Pending games should not affect this page.
8. Create a second group to check that its link opens its own leaderboard.
   Opening and closing a board should preserve the selected group and any
   unsaved player, game-setup, or score-entry fields.
9. Check the empty state before adding players and before saving a result.
   Try long group/player names, larger iPhone text settings, and VoiceOver.
   Names and stats should remain readable, links should announce their group,
   and the back button should stay available while scrolling.
10. Reload, then sign out and log in again. Saved groups, players, and game
    results should return. Unsaved fields should not.
11. Log in as an added player on another device and pull down on Home, Stats,
    or Groups to refresh. There are no refresh buttons; failed initial loads
    show an error and allow another pull to retry, even on a short/empty page.
    Members should be able to add players, start games, and record scores, but
    not delete games or change visibility. Conflicting edits should prompt a
    refresh, not overwrite data.
12. As creator, open the small **Group settings** button and make a test group public.
    Another account should find only its name, creator name, and player count
    in Search, then request to join. Pull down in group settings and review it as creator. A pending or declined
    requester must not see the roster or results before becoming a member.
13. Test declining and requesting again, and switching to private with a
    pending request. The request must remain reviewable; private groups must
    disappear from search. Existing groups remain private until explicitly changed.
14. Confirm the group overview has one leaderboard button, a **View players**
    link, two **Game Types** buttons per row, and only completed games in **History**
    at the bottom. The player table belongs on its own page, with blank / **Name**
    headers and readable long/duplicate names. New-game setup and
    pending score forms should appear only on the dedicated game page.
    Test both on-screen and Android back navigation, bottom tabs, and preserving
    an unfinished team selection or score while returning to the overview.
15. Use **Game Types > Create a tournament**. Only the
    owner and admins can create either format, clear results, and start/reset fixed-team
    playoffs; members can score. Check rotating selection at 4, 6 (rejected), and
    8 players, shared ranks, every partnership once, completion, and reset.
    Tournament matches are scored there, not on the casual game page. Completed
    matches appear in History and count toward individual statistics, with no wager.
    Tap a completed tournament card to open its tournament. Pull down to reload
    tournament data and retry errors, including when the group revision did not
    change. Also check pull-to-refresh in Search and on the leaderboard.

These are manual device checks, not claims that device testing has been performed.

Also check new-group creator enrollment, role changes and failed/retried saves,
Owner/Admin roster labels, admin versus member controls, and demotion after
refresh. Admins must not see ownership/deletion controls, have administered groups
classified as owned, or be blocked from account deletion merely for being admins.

## Project layout

- `App.tsx`: authenticated loading, refresh, group selection, and local view state
- `src/features/auth/`: signup, login, email confirmation, and authenticated app access
- `src/services/`: auth, native session storage, Azure API client, and tests
- `api/`: Azure Functions API, SQL repository, schema, and server/integration tests
- `infra/`: Azure resource definitions, managed identities, networking, and budget alerts
- `supabase/`: restricted player-lookup migration and rollback-only database tests
- `src/domain/`: pure group/game calculations and colocated domain tests
- `src/types/`: shared domain model types
- `src/features/groups/`: group, game entry, standings, leaderboard, and history presentation
- `index.ts`: Expo root registration
- `app.json`: app metadata and platform configuration
- `assets/`: template icons and image assets; replace before release
- `.github/copilot-instructions.md`: project-specific AI coding guidance
- `.vscode/mcp.json`: GitHub MCP connection using interactive OAuth

Keep score validation, standings, and simulated money calculations independent
of UI and storage. Do not infer missing product rules.

## Working safely

- Use synthetic player data in tests and examples.
- Never commit tokens, local environment secrets, or signing credentials.
- Ask before adding dependencies, backend services, or major architecture.
- Keep the lockfile updated with intentional dependency changes.
- The Expo starter includes its upstream MIT license in `LICENSE`.
