# Authentication setup

The app uses Supabase Auth for email/password accounts. Login is required to
open the group workspace. The [Azure backend](azure.md) persists groups, player
records, memberships, and games. Sign-out clears only local views and unsaved
drafts; successfully saved data returns after login or app restart.
Group players are linked to verified Supabase accounts by their immutable
account IDs. Display names are chosen by account holders after login.

## Supabase project

The examples below use **DinkNow** branding. For an existing project, update any
old app name in the hosted Confirm signup and Reset password subjects/bodies
through the Supabase dashboard. Renaming this repository's app configuration
does not update hosted email templates or change the Supabase project.

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
   A Free organization is sufficient for initial testing. Keep the generated
   database password in your password manager, never in this repository.
2. In Authentication's Email provider settings, enable email signup and keep
   **Confirm email** enabled. Set the minimum password length to **12**.
3. In **Authentication > Email Templates > Confirm signup**, replace the
   confirmation-link body with a code-based template:

   ```html
   <h2>Confirm your DinkNow account</h2>
   <p>Enter this verification code in the app to finish signing up:</p>
   <p><strong>{{ .Token }}</strong></p>
   <p>If you didn't create this account, you can ignore this email.</p>
   ```

   The app accepts the email code with Supabase's `verifyOtp` API. This avoids
   deep-link redirects and works with Expo Go without a custom URL scheme.
4. Get the Project URL and **publishable key** (`sb_publishable_...`) from the
   project's Connect dialog / **Settings > API Keys**.
5. Copy [.env.example](../.env.example) to `.env` if it does not already exist,
   then enter these public connection settings:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   ```

   `.env` is Git-ignored. `EXPO_PUBLIC_` values are embedded in the client
   bundle, so they must never contain privileged credentials. Do not use
   `sb_secret_...`, a legacy `service_role` key, the database password, an SMTP
   password, or a user's login password. The app intentionally accepts only
   the new publishable-key format.
6. Restart Expo after changing `.env`. Missing or invalid configuration shows
   a setup error; it never falls back to an unauthenticated group workspace.

### Signup email opens localhost

The app expects a numeric code entered inside DinkNow, not a browser callback.
A hosted template using `{{ .ConfirmationURL }}` sends a link that can redirect
to Supabase's default localhost Site URL. Changing a local documentation example
does not change the hosted email template.

On 2026-10-24, the development project's **Confirm sign up** body was replaced
with the code template above, saved, and verified on a fresh dashboard page.
Its existing subject and SMTP settings were left unchanged. The recovery
template was also observed to use `{{ .Token }}` and was not changed.

Request a fresh confirmation email with **Resend verification code** and enter
the newest code inside the app. Old emails are not rewritten by a template
change. If an old link already confirmed the account before its browser redirect
failed, return to DinkNow and try logging in; use a new disposable account to
test the updated signup flow. No native rebuild is needed for this hosted
template change. Do not disable email confirmation or point auth redirects at
a LAN/Metro server to bypass the problem.

## Password recovery

Choose **Forgot password?** on the login page, request a recovery code, verify it,
then enter and confirm a new password of at least 12 characters. **I already have
a recovery code** supports returning after an app restart. Invalid/expired codes,
email throttling, password-policy failures, and network errors remain explicit.
Email-request confirmation does not reveal whether an address has an account.

In **Authentication > Email Templates > Reset password**, configure a code-based
body using `{{ .Token }}`:

```html
<h2>Reset your DinkNow password</h2>
<p>Enter this recovery code in the app:</p>
<p><strong>{{ .Token }}</strong></p>
<p>If you did not request this, ignore this email.</p>
```

Recovery uses `verifyOtp` with type `recovery` on a separate, nonpersistent
Supabase client with a distinct storage key and automatic refresh disabled.
Recovery tokens are never stored in SecureStore or passed to the regular
authentication gate; verifying a recovery code does not open the workspace.
No deep-link registration or new dependency is required.

After updating the password, recovery requests global sign-out and returns to
login. A failed sign-out has its own retry step; it does not resubmit the password
or claim that recovery finished. Existing refresh sessions are revoked by
Supabase; already-issued access tokens can remain valid until expiry.
On 2026-10-24, the user confirmed custom SMTP is configured and a non-team email
address received a verification email. The user subsequently confirmed
email-code password recovery and signing in with the new password in TestFlight
1.0.0 (2). The reset template was observed to contain `{{ .Token }}`.
The corrected signup template still needs a fresh-email/device check; complete
expiry, throttling, interruption, and session-revocation acceptance remains separate.

## Account deletion and reauthentication

The locally prepared **Settings > Delete account** flow requires the current
password and typed/final confirmation. Password reauthentication uses another
nonpersistent Supabase client; it must return the same remotely verified account,
not change the ordinary workspace session. Only the resulting access token is
sent to Azure. Passwords and refresh tokens are not sent to the data API.

The API first validates that token with Supabase, then requires a `password`
authentication-method claim no older than five minutes. A recent JWT issue time
alone is not sufficient, because token refresh does not prove password entry.
All owned groups must first be transferred or deleted. Shared history follows
the approved [account lifecycle policy](product.md#account-and-group-lifecycle).

The phone never receives an administrative key. SQL migration 008 and the API/
worker code were deployed to development on 2026-10-23. A read-only check on
2026-10-24 confirmed a server-only Supabase secret is already present without
printing or changing it. Real provider deletion, worker completion, and native
edge-case acceptance are separate from configuration presence. The user
subsequently confirmed disposable-account deletion reached completion in
TestFlight 1.0.0 (2), and the deleted account could no longer sign in. This does
not verify every shared-history, ownership, interruption, or retry case; see
[Azure lifecycle setup](azure.md#account-lifecycle-setup).
The final screen distinguishes queued deletion from confirmed completion and
retries local sign-out separately if secure-session cleanup fails. A receipt can
be checked without the now-deleted login; it returns status only, not account data.

## Registered-player lookup

Run [the registered-player migration](../supabase/migrations/202610210001_registered_players.sql)
once in the project's SQL Editor, followed by
[the avatar migration](../supabase/migrations/202610230001_player_avatars.sql).
The latter transactionally replaces the lookup's return shape while preserving
the same eligibility checks and restricted grants. The setup creates `public.find_registered_player`
with a fixed empty search path and execute permission only for `authenticated`.
It checks the caller's verified, non-deleted, non-banned account before looking
up the exact requested UUID. The target must also be verified, non-deleted,
non-banned, and have a nonempty string display name.

The function returns only ID, display name, and avatar ID, never email. Names are stored in
`auth.users.raw_user_meta_data.display_name` using Supabase Auth's current-user
`updateUser` API. Metadata supplies a label only; verified status is read from
the managed `email_confirmed_at` column, not user-editable metadata.
No custom profile table, email directory, or client admin API is needed.
Do not grant app clients direct access to the managed `auth.users` table.

Both existing and new accounts see **Choose your player name** when a display
name is missing. Open **Settings** using the bottom taskbar,
then choose **Change display name**. The editor is prefilled; **Save player name**
updates the account, confirms Azure synchronization through `GET /me`, and returns to settings, while **Cancel** returns without
saving. **Back to home** returns to the home page. Groups and in-progress entries
stay mounted in the background.
The response must match the signed-in ID and requested trimmed name. If the
account save succeeds but synchronization fails, the editor stays open and offers
**Save player name** again; it does not report overall success.
The current name appears in all cached rosters and owner labels, casual/tournament
selectors, standings, existing history, and brackets. Tournament views use the
latest group profile data even when the game revision has not changed. Older
in-flight reads cannot undo a confirmed local profile change; fresh reads still
accept later changes from another device. Player IDs, selections, teams, games,
standings values, and group revisions stay unchanged.
Membership snapshots remain stored but are not the registered player's display
label. Guest names and anonymous Deleted player labels stay group-local.
The [updated API roster read was deployed and verified](azure.md#current-display-name-rollout-2026-10-27-utc);
no schema migration was needed. The client save/cache updates are available in
Expo Go and require a later approved native release beyond TestFlight 1.0.1 (3).

**Settings > Change avatar** opens a 24-emoji picker. The smiling face is the
default, and selecting it again resets the avatar. The current-user `updateUser`
API stores the chosen ID in `raw_user_meta_data.avatar`; unknown out-of-band
values produce a diagnostic without the metadata contents and use the default.
The app then calls the authenticated Azure `GET /me` endpoint and checks the
matching account and avatar before reporting success. If that second step fails,
the editor explains that the account save succeeded but group synchronization
was not confirmed; **Save avatar** retries safely. Other devices see the new
avatar when they refresh. Existing completed games use current names and avatars
without changing their results or rewriting membership snapshots.

The Azure API, rather than the phone, calls the restricted lookup when adding a
member. It mirrors verified ID/name/avatar records into Azure SQL and stores the
membership's name snapshot. Account passwords and emails are not stored in Azure.

In Settings, **Copy player code** loads the authenticated Azure `/me` profile
and copies its six-character code, showing **Player code copied.** It does not
copy the account UUID, email, or session token. Codes use uppercase letters
and digits excluding `I`, `O`, `0`, and `1`; typed input is case-insensitive.
Load failures show an explicit error and **Retry player code**. Copy is disabled
until the server confirms the current account's code. Clipboard failures show
an error; the displayed code can also be selected and copied manually.
A group member pastes the code into **Player code** and selects **Add registered
player**. Previously shared full UUIDs remain accepted. Unknown,
unverified, banned/deleted, or unnamed targets receive the same unavailable
player message. Missing backend setup and network errors are explicit.

Codes are public identifiers, not authentication secrets or permission grants.
Azure owns allocation, uniqueness and lookup; no editable Supabase metadata
field or public code-search endpoint is introduced. Group access is checked
before resolution, and the resolved UUID still goes through the restricted
verified-account lookup. A deleted account's code is retained only as an
unlinked reservation so it cannot identify a different account later.
The approved [migration/API rollout](azure.md#six-character-player-codes) is
deployed to development. Reload Expo Go for the new UI; TestFlight 1.0.1 (3)
still shows full IDs. Older servers in other environments produce an explicit
unavailable-code message, not a fake code.

For participants without accounts, only the group creator can use the
**Add a guest player** section on **View players**. This
creates a server-generated, group-scoped participant, not a Supabase account
or an access grant. Guest names display with **(g)**, use the default emoji,
and participate in group statistics. Guest IDs do not work in registered-player
lookup, authentication, or profile synchronization. No email is collected or
sent, and no automatic linking occurs if the person later signs up.
Removing a registered player only revokes that group's membership, not their
Supabase account or membership elsewhere. Removing an unused guest deletes its
SQL record; no Supabase account exists to delete. Both actions are creator-only,
and any game or tournament participation blocks removal.

Display names need not be unique. Full account IDs distinguish matching names
throughout groups, teams, history, and leaderboards. The same account cannot
be added to a group twice. Registered names come from the synced account profile;
other devices see edits when they refresh, without a push subscription.
Eligibility is checked at addition, not continuously synchronized.

Group rosters show an emoji and display name only. The signed-in player's own
email remains in their private Settings account details, not in group tables,
player lookup responses, game history, or public discovery.

The transition from the in-memory prototype starts with an empty Azure database,
as approved. Old local groups are not imported by guessing accounts. Once a
group is saved through the new API, reloads no longer erase it.

## Email restrictions during testing

Supabase's built-in mail sender only sends to addresses belonging to the
Supabase project's organization team. It is heavily rate-limited (currently
two messages per hour) and is not a production email service. For this first
test, use your Supabase organization-member email as the app account email.
The Supabase dashboard account and the DinkNow app account are separate
accounts, even when they use the same email address.

Before allowing other users to sign up, configure a custom SMTP provider in
Supabase. Choose and configure that provider separately; SMTP credentials
belong in Supabase's server-side configuration, never in the Expo app. Do not
disable email confirmation or add ordinary app users to the Supabase project
team to work around email restrictions.

Repeated signup for an existing email may receive a generic response for
account-enumeration protection. The UI does not promise that an account or
email was created. Existing users should log in or use **Confirm email**.
Resend errors and provider rate limits are displayed, not treated as success.

## Session and data lifecycle

- Passwords are submitted to Supabase over HTTPS and are not saved by the app.
  Password fields are cleared when changing auth modes and after successful
  signup/login. Never log passwords, codes, tokens, or complete session objects.
- Supabase access/refresh sessions are stored with Expo SecureStore, using
  device-only, unlocked-device access on iOS. There is no plaintext fallback.
  Native storage failures are surfaced. Very large session payloads can exceed
  platform-specific SecureStore limits; test on supported devices.
- Startup checks a saved session against Supabase before displaying groups.
  Network/storage errors show retry and sign-out actions rather than silently
  authorizing a cached user or pretending there is no session.
- Token refresh runs while the signed-in app is active and stops when it is
  backgrounded. Refresh events for the same account do not reset group state.
- Signing out requires confirmation because it clears local views, selections,
  and drafts, not saved Azure data. It signs out this device's session, not
  every device. A different account loads only its own and joined groups.
- Supabase may remove a local session even if server-side revocation fails.
  The app follows the sign-out event, clears the local view, and still displays the
  failure. Do not mistake an error notification for a guarantee that the local
  session remains signed in.
- Keychain data can survive app reinstallation on iOS. Sign out explicitly
  when using a shared device; uninstalling is not a reliable sign-out method.
- Accounts and account display names persist in Supabase. Azure stores player
  records, groups, memberships, and games. The API validates the Supabase token
  and verified account before touching the database; tokens never become SQL
  credentials. Only Azure managed identity accesses the database at runtime.

## Verification

```powershell
npm test
npm run typecheck
npx expo install --check
npm run start:device
```

The Node tests cover configuration, credential/code validation, error
messages, the Supabase adapter contract, session validation, local sign-out,
subscriptions, refresh lifecycle calls, display-name onboarding, exact-ID
lookup contracts, duplicate accounts, and matching-name labels, alongside
existing group rules.
They use synthetic accounts and mocked provider responses; they do not create
real accounts, send email, or verify native SecureStore or iPhone UI behavior.

[The database regression script](../supabase/tests/registered_players.sql)
can be run in the Supabase SQL Editor after the migration. It uses synthetic
accounts inside a transaction that rolls back all fixtures, and checks caller
permissions plus eligible/ineligible targets. It does not send email, change
real accounts, or leave test accounts behind.

On your iPhone:

1. Create an account using your authorized test email and a unique password.
   Verify mismatched/short passwords fail without sending a signup request.
2. Enter the emailed code. Confirm an invalid/expired code shows an error.
   Avoid unnecessary resends because of the default email limits.
3. Choose a display name, open **Settings > Copy player code**, and add the account
   to another member's group. Creators are already enrolled in their own new groups.
   Confirm the clipboard contains exactly six characters, lowercase input works,
   and the same code remains after a rename, sign-out, and another-device login.
   Confirm adding the same account again (by code or legacy full ID) fails. Invalid and unknown codes must
   not add a registered player. Four distinct roster players are required
   for doubles; they may be registered accounts or guests added by the creator
   through **View players > Add a guest player**. Guest creation never bypasses
   the account checks for a registered player ID.
   Use **Settings > Change display name** to test saving and canceling an edit. The account
   header should update only after a successful save, without losing groups or
   drafts. An empty name should show an error and keep the editor open.
   Confirm current names in existing group rosters, both tournament setup formats,
   selected-team previews, score entry, completed games, standings, and brackets.
   Refresh from another account/device and check matching-name ID labels, unchanged
   guests/Deleted player entries, and preserved team selections. Simulate an API
   sync failure after account save and verify the explicit retry, without a success notice.
   Check the bottom tabs' VoiceOver labels, copying/pasting the exact ID, back navigation,
   and closing settings without losing a group-form draft. Back navigation is
   blocked while a name save is pending.
   Opening settings must not produce duplicate React key warnings. The
   authenticated workspace still resets when the account changes.
4. Background and reopen the app. Verify the current workspace remains.
   Fully reload the app: login and saved groups/results should restore.
5. Start filling a form, open settings, cancel a sign-out prompt, and verify the draft remains.
   Confirm sign-out and log in again: saved groups should return, but drafts should be gone.
6. Test a wrong password, an unconfirmed account, and an offline session
   restore. Errors should be clear and no group workspace should appear before
   a successful session check.
7. After configuring SMTP for multiple test accounts, sign in as a different
   user and verify unrelated groups and previous drafts do not appear. Add that
   user's shared ID to a group in the first account, then refresh in the member
   account: it should see that group and be able to add players/start games/record
   scores, but not delete games or manage visibility/requests. Also test matching display names,
   leaderboards, and switching groups/signing out during a slow lookup.

Recovery and account-deletion code are implemented, and the lifecycle schema/API
are deployed to development. Their provider configuration, operational deletion
worker verification with disposable accounts, and live-device acceptance remain release
blockers. Social login, MFA, offline writes, and real-time push are not implemented.
Review abuse controls/email delivery and validate provider settings before release.
Track that work in [release readiness](release-readiness.md). A working
developer-email login does not demonstrate that arbitrary new users can sign up.

References: [Supabase React Native auth](https://supabase.com/docs/guides/auth/quickstarts/react-native),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp),
[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
