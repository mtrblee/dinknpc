# Group standings prototype

## Purpose

DinkNow tracks scores and individual rankings among members of player-created
pickleball groups. Owner-created tournaments support fixed-team round robin
with seeded playoffs, or rotating-partner round robin with individual rankings.

## Approved prototype scope

- An email/password account is required to access the app. Supabase Auth
  manages accounts; a TypeScript Azure Functions API persists player records,
  groups, memberships, and games in Azure SQL Database.
- Successfully saved data survives sign-out, reloads, and device changes.
  Signing out clears only the device's local view and unsaved form entries.
  Another account must never inherit the previous user's local workspace.
- The creator and added registered members can view the group and its leaderboard.
  All members can add verified players, start games, and record final scores.
  The owner and admins can add guests, remove players, cancel/delete games,
  change the group avatar or visibility, review join requests, and manage tournaments.
  A new group's creator is automatically included in its playing roster.
  Existing rosters are not backfilled; replaying a creation never re-adds a removed creator.
- Writes require an internet connection and server confirmation. There is no
  offline write queue or real-time push synchronization. Pull down on Home,
  Stats, Groups, Search, or the leaderboard to load other devices' changes;
  switching tabs also refreshes. There are no data-refresh/reload buttons.
  Failed loads remain explicit and instruct users to pull down to retry,
  rather than appearing as empty group lists. Pulling within group settings
  also reloads join requests; pulling within tournaments reloads tournament
  data even after a failed load with an unchanged group revision.
- Home and Groups load authorized group summaries rather than full rosters and
  game histories. Summaries include every roster entry (registered, guest, and
  anonymous) in player counts and only completed games in completed-game counts.
  Summaries also include the latest known completed-game timestamp, calculated
  from the same authorized group without fetching histories. Pending games and
  profile edits do not count as completion activity; deletion recalculates it.
  Group selection loads full detail before opening; Stats loads full histories
  on demand. Summary data is never used as an editable group or incomplete
  standings input. Hidden screens mount on first visit and retain their drafts.
  In-memory summaries/details are account-scoped; removals and newer revisions
  override older in-flight loads. No persistent/offline cache is introduced.
- Names are trimmed and nonempty. Group names are case-insensitively unique
  among groups created by the same account. Registered player display names may match, but a Supabase account
  ID may appear only once within a group.
- Registered players are added by an exact six-character shareable code, or a
  previously shared full UUID, after a server-side
  check confirms an existing, email-verified, non-deleted, non-banned account
  with a display name. Guests without accounts are added separately by name.
- Codes contain uppercase letters and digits, excluding `I`, `O`, `0`, and `1`;
  typed codes are case-insensitive. They are stable, globally unique aliases,
  not credentials. Internal account IDs, memberships, teams, and history remain
  UUID-based. Settings loads/copies the server-issued code and exposes load/copy
  failures with retry/manual-copy options rather than substituting a UUID.
  Matching registered names use codes where available; legacy responses and
  guest/anonymous labels retain full-ID disambiguation. Deletion retires the
  code permanently and removes its account association. Migration 010 and the
  updated API are deployed to development; the code UI is available in the
  current Expo Go app, not the existing TestFlight 1.0.1 (3) binary.
- A doubles game uses exactly four distinct players from the selected group's roster.
  Partners can change between games. Singles are not supported.
- A new group chooses a fixed currency: **None** (default), **Money**, or **Boba**.
  Existing groups retain Money so historical USD results keep their meaning.
- Before score entry, casual games lock their teams and any simulated per-player
  wager. None offers no wager input and rejects nonzero wagers on the server.
  New Money wagers accept whole USD dollars only: a $1 minimum bet, or 0 for no
  wager. Decimal text (including `1.00`) is rejected, not rounded or truncated.
  Values remain stored as integer cents; previously saved wagers, including
  pending games, keep their exact amounts and can still be scored or deleted.
  Boba accepts nonnegative whole drinks, stored as integer counts. Blank means zero
  for either. Tournaments remain wager-free for every group currency.
  Pending games do not affect standings.
- Completed scores must be nonnegative whole numbers and cannot be tied.
  Casual doubles games have no target score, score cap, or win-by-two rule.
  Tournament matches use the separate rules below.
- Reject values or accumulated totals outside JavaScript's safe integer range.
  Invalid input leaves all existing results and totals unchanged.
- The API reuses the pure TypeScript game rules and validates writes inside SQL
  transactions. Group revisions reject stale edits, and idempotency keys prevent
  duplicate writes when the same uncertain request is retried.

## Group avatars

- Groups have a separate 12-emoji catalog, independent of player avatars.
  The creator selects one during creation; the owner and admins can change it in **Group settings**.
  Existing groups and an untouched creation form use the paddles avatar.
- Avatar changes save immediately after selection, require owner or admin permission
  and the current group revision, and preserve currency, players, scores,
  timestamps, tournament documents, and statistics. Failed saves remain explicit;
  the old avatar stays selected until the server confirms a change.
- Show the saved avatar on Home, group tiles, public search, per-group individual
  statistics, and group/leaderboard headers. Public discovery exposes the group
  avatar, not any member's profile. Refresh loads changes from another device.

## Guest players

- The owner and admins can add guests, using the separate **Add a guest player**
  section below **Add a player** in **View players**. A nonempty,
  trimmed display name is required; no account, email, or player-ID lookup is needed.
- Guests persist on that group's roster and can be selected for casual games
  and tournaments. Neither setup page creates guests; add them on **View players**
  first. Success updates the roster and clears only the guest form. Failure
  keeps the name and displays the error; the registered player-ID draft is preserved.
- Guest names must be unique among guests in that group, ignoring capitalization
  and surrounding whitespace. A registered Alex and guest **(g) Alex** may coexist,
  and another group may have its own unrelated guest named Alex. Existing duplicate
  guests receive collision-free numeric suffixes during migration, preserving their
  IDs, games, tournaments, and statistics.
- Guest IDs are generated on the server, independently per group. The saved
  name stays unprefixed; all roster, selection, score, leaderboard, champion,
  and bracket labels display **(g)** before it. Matching visible names include
  their code for registered accounts, or full IDs for guests and anonymous
  participants. Guests use the default smiling emoji.
- Guests participate in wins, losses, shared ranks, point differential, and
  currency-appropriate simulated totals just like registered players. Mixed and all-guest
  games/tournaments are allowed; four distinct player IDs and no repeated
  selected tournament participant still apply. Fixed teams or rotating schedules
  remain locked after creation.
- A guest is a participant, not an account or an access grant. Guest IDs cannot
  log in, join another group through registered-player lookup, or be promoted
  by profile synchronization. No automatic conversion, account linking, or
  history merging is implemented if a guest later registers.
- Guest creation is an additive, serialized operation with an idempotency key
  independent of the group revision. Retrying an uncertain save after refreshing
  reuses the same guest instead of adding a duplicate. Concurrent submissions
  with different request keys cannot create duplicate guest names in one group.

## Removing players

- The owner and admins can use a player's labeled **Remove** button on **View players**. A
  confirmation explains the effect before any request is sent.
- Removal is blocked if the player appears in any pending or completed game
  or any tournament. No results, fixed teams, ranks, or simulated totals are
  deleted or rewritten as a side effect.
- A registered player is removed only from this group's roster and membership.
  Their account and other groups are untouched. They may be added again or
  request to rejoin a public group. Removing the creator from the playing
  roster does not change ownership or creator access.
- An unused anonymous Deleted player entry can also be removed from its group.
  Its local record is deleted; no registered account remains to delete or restore.
- Removing an unused guest deletes both its roster entry and its guest record
  atomically. A newly added guest may then reuse that name, with a new ID.
  Guests are never shared across groups or created outside an existing group.
- Removal requires the current group revision and an idempotency key.
  Stale edits and blocked removals are explicit errors. Concurrent game or
  tournament creation cannot race past the removal check.
- Setup drafts detect removed selections, keep unrelated names/wagers/teams,
  and prompt for replacements. An affected fixed-team draft must be removed
  and recreated; saved tournament teams cannot lose their players.

## Account and group lifecycle

Migration 008 and the lifecycle API were deployed to development on 2026-10-23.
A read-only check on 2026-10-24 confirmed its server-only Supabase key is present;
the user subsequently confirmed password recovery and completed disposable-account
deletion in TestFlight 1.0.0 (2), including rejection of later sign-in. Full
lifecycle edge cases and native game/tournament acceptance remain separate.

- **Forgot password?** uses an emailed recovery code and a separate,
  nonpersistent authentication session. Verification does not open the app's
  workspace. A new password requires at least 12 characters and confirmation.
- The current owner can transfer a group to another active registered roster
  member in **Group settings**. Guests and deleted participants cannot own groups.
  Ownership alone controls group deletion and transfer; admins share the other
  management permissions. "Owner" means the current owner, not an immutable founder.
  Group names remain unique per current owner; a conflicting transfer is rejected.
- Transfer does not add the former owner to the roster. They retain ordinary
  member access only if already on the roster, without automatic admin status.
  The new owner's separate admin flag is cleared; other admins remain unchanged.
  The group leaves the owned section and appears
  in joined groups only when membership remains.
- **Delete group** requires typing `DELETE` and a final confirmation. It removes
  the entire group's games, tournaments, requests, memberships, and local
  guest/anonymous records. Registered accounts and other groups are unaffected.
  Retrying a committed deletion succeeds without recreating the group.
- **Settings > Delete account** first requires transferring or deleting every
  owned group. The server rechecks this condition transactionally, independently
  of the screen's group list. Confirmation also requires the current password.
- In other groups, unused memberships disappear. Historical participants become
  **Deleted player**, with a fresh server-generated ID independently in each
  group and a reset avatar. The original ID/name snapshots are removed; no
  identity mapping to the anonymous participants is retained.
- Existing pending/completed games, scores, timestamps, counters, ranks, and
  simulated totals remain unchanged apart from participant identity. Existing
  tournaments can finish or reset using their already-fixed anonymous
  participants. They cannot be selected for a new casual game or new tournament.
- Accepted deletion immediately blocks Azure data access and anonymizes/removes
  associated SQL data in one transaction. A durable job then hard-deletes the
  Supabase account and retries provider/persistence failures. Acceptance is not
  reported as completed deletion. The status screen clears the device session,
  distinguishes pending/retrying/completed, and exposes a non-identifying receipt.
  Closing the screen/app does not cancel the server's request.
- The job's original account UUID is removed after Supabase deletion is confirmed.
  A one-way account-ID hash and non-identifying receipt metadata remain to block
  stale authenticated writes. They do not link to anonymous score participants.
  Privacy disclosures and backup/log retention still require release approval.

## Group admins

- **Group settings > Admins** lets the owner or an admin promote/demote another
  active registered player, with confirmation. Guests, anonymous/deleted
  participants, the owner, and the current actor are excluded. Changing your
  own admin access requires another admin or the owner.
- Admins can manage players/guests, casual game deletion, group visibility/avatar,
  join requests, tournaments and corrections, and other admins. Only the owner
  can **delete the group** or **transfer ownership**. Existing roster-removal
  restrictions still apply; removing an owner from the roster never removes ownership.
- Owner/Admin labels appear in the roster. Admin groups stay in **Groups you joined**,
  not **Groups you own**, and do not block account deletion as owned groups.
- Roles belong to a group membership, not the global player profile. Removing a
  membership or deleting its account removes its admin access. Rejoining does not
  restore a previous role, and anonymous history never inherits admin access.
- Every role change uses a group revision and idempotency key. The server reloads
  permissions under the mutation transaction; stale views cannot authorize a write
  after demotion. Failed changes retain the saved role and show an error.
- Migration **009_group_admins.sql**, the updated API, and updated clients are
  required for this feature. Existing memberships default to non-admin. This
  migration/API rollout is deployed to development. Other environments still
  require the migration before deploying the API; reload updated clients together.

## Activity timestamps

- Games and tournaments display **Created** with their creation date/time while
  in progress, then **Completed** with the saved completion date/time.
  Times are assigned by the server, stored as UTC instants, and displayed in the
  device's local time zone. Reading, refreshing, and retrying a successful write
  do not change those times.
- Existing tournament creation dates are retained. Historical game dates and
  tournament completion dates that were never recorded show **Time unavailable**;
  they are not replaced with today's date or a guessed creation/completion time.
- A fixed-team tournament completes when its championship result is saved, using
  that game's completion time. A rotating tournament completes after every
  scheduled game is saved, using the latest completion time across those games,
  regardless of schedule order. Clearing a result removes its completion time and
  restores its original creation time for display. Resaving records a new
  completion time. Resetting playoffs preserves the tournament's creation time.
- Pool games are created with the pool schedule. Playoff games are created when
  both teams become known. Future bracket slots and byes are not played-game
  records and have no game timestamps yet.

## Per-player calculations

Only completed games count:

- A player on the winning team receives one win; a losing player receives one loss.
- Each player's point differential increases by their team's score minus the
  opposing team's score. This is a team-score differential attributed to each
  player, not individually scored points.
- Each winner gains the simulated per-player wager; each loser loses it.
  A $5 doubles game produces +$5 for each winner and -$5 for each loser, not a
  $5 team pot. Boba follows the same per-player rule using whole drinks.
  The total simulated change across the four players is zero.
- None hides simulated net entirely. Money displays **Simulated net (money emoji)**;
  Boba displays **Simulated net (boba emoji)**. Positive net and point differential
  have light green backgrounds and readable green numbers; negatives use light
  red backgrounds and red numbers; zero uses a neutral treatment. Per-group
  individual statistics never combine different currencies.
- The net is cumulative simulated game performance, not an account balance,
  payment status, amount settled, or payment instruction.

For example, Alex and Blair beating Casey and Drew 11-7 with a $5 wager yields:

| Player | Wins | Losses | Point differential | Simulated net |
| --- | --- | --- | --- | --- |
| Alex | 1 | 0 | +4 | +$5.00 |
| Blair | 1 | 0 | +4 | +$5.00 |
| Casey | 0 | 1 | -4 | -$5.00 |
| Drew | 0 | 1 | -4 | -$5.00 |

These names are synthetic examples.

## Accounts

- Users can sign up with an email and a password of at least 12 characters,
  confirm an emailed code, log in, and sign out. Email confirmation is required
  in the Supabase project configuration.
- Authentication is isolated behind an explicit service interface. Passwords
  are not persisted by the app; sessions use native secure storage.
- A stored session must pass a Supabase user check before the group workspace
  is shown. Authentication/configuration failures are explicit, never a guest
  login or other successful fallback.
- Sign-out warns that local drafts will be discarded, but saved data remains.
  Signing out or changing accounts unmounts the local workspace; refreshing
  the same account's token preserves it.
- Existing and new users choose a display name before using groups. Supabase
  account metadata remains the name's source; Azure stores a durable ID/name
  player record refreshed by authenticated activity and verified-player lookup.
  Neither display names nor user-editable metadata grant permissions.
- Registered players may choose one of 24 emoji avatars in **Settings > Change avatar**.
  The default is a smiling face. Avatar IDs, not uploaded images or arbitrary
  text, are stored in Supabase account metadata and mirrored in Azure.
  Saving requires account confirmation and successful Azure synchronization;
  a partial failure explicitly offers a retry. Unsupported out-of-band metadata
  is logged without its contents and displayed as the default so the account
  holder can repair it in Settings.
- Avatars are account-wide and current, including in existing groups and old
  completed games. Other devices load changes on refresh; there is no push
  subscription. Registered display names likewise use the current synced profile
  throughout rosters, selectors, game history, standings, and tournament brackets.
  Group rosters show only emoji and display name, never account email.
- The bottom navigation opens a separate **Settings**
  page containing **Change display name**, **Copy player code**, and **Sign out**.
  The name editor starts with the current name. Cancel returns without saving;
  a save returns to settings only after account storage and Azure synchronization are confirmed.
  A partial failure keeps the editor open with an explicit retry. Group views and
  drafts remain mounted underneath; names update without changing selected IDs,
  fixed teams, scores, ranks, or simulated totals. Current names also apply to
  existing history. Guest and anonymous Deleted player labels remain unchanged.
  Settings uses a compact horizontal profile, divided edit rows, an inline
  code-copy action and understated sign-out/deletion rows. Controls keep at
  least 44-point touch targets and text can wrap. Copy/retry errors and account
  deletion's review, confirmation and reauthentication are unchanged.
- **Copy player code** copies only the server-issued six-character code and
  confirms success. Loading and copying failures are shown explicitly, with
  retry and selectable-code text as manual options. No UUID is copied as a code.
  Existing group members
  paste it into **Player code** and choose **Add registered player**. Legacy full
  UUIDs still work. Join-request lists also show codes when available, while
  approval commands keep using internal UUIDs. The app
  fetches the name; creators cannot assign a name to another account.
- The home screen no longer shows the Azure information panel. Simulated-money
  disclosures remain in settings and the game/standings interfaces.
- Lookup is restricted to verified, signed-in callers and returns only the
  exact requested eligible account's ID, name, and avatar. There is no user directory,
  email search, or client-side admin key.
- Account membership eligibility is checked by the API when adding a registered player.
  Stored membership snapshots are retained, but registered roster labels come from
  the current player profile. Refreshing loads other devices' changes, without a
  real-time subscription or a change to group revisions.
  Owners/admins can remove unused group members; only the owner can transfer ownership.
- Matching visible names include their full player IDs in player lists, team selection,
  game history, and standings so distinct participants remain distinguishable.
  Sharing an ID alone does not grant access. The creator's successful addition
  makes that account a member of that specific group. Direct additions by any
  existing member take effect immediately; this is separate from the
  creator-reviewed join-request workflow.
- Initial email testing uses the Supabase organization-member address. A custom
  SMTP provider is required before signup can serve arbitrary new users.

See [authentication setup](authentication.md) for configuration and device checks.

## Home and navigation

- The shared theme uses burnt-orange branding, warm cream backgrounds,
  dark-brown text, and peach selection highlights. History and tournament matches
  use sage-green winning-team highlights and plain completed scores. Blue identifies
  the signed-in player's current game as well as score-entry accents; red errors
  and gold leader highlights retain their distinct meanings.
- Home leads with **Your group. Every game.**, explains that groups keep
  pickleball games, scores, and standings together, and provides a prominent
  **Create a group** button that opens the name-entry page directly.
- **Your groups** shows the total group count and up to three saved groups,
  sorted by their latest known completed-game timestamp, newest first, before
  taking the three. It shows player/completed-game counts, a local completion
  date and one-tap access. Groups without known completion dates come last;
  ties preserve existing order. No completed games and unknown historical
  dates have distinct labels; creation dates are never substituted.
  **View all groups** opens the full list.
  New users see create/join guidance, while unloaded or failed data is not
  presented as an empty account.
- **Explore** keeps public-group search and individual statistics
  available as secondary actions. Bottom navigation still provides Home,
  Stats, Groups, Search, and Settings shortcuts.
- The group counts include groups created or joined, never pending
  requests. Its separate page shows the signed-in account's rank and existing
  per-player statistics independently for each group; there is no invented
  overall rank. Creators not in the playing roster are shown as not playing.
- Individual statistics uses compact, two-column group tiles with the group
  avatar, rank, wins/losses, point differential, and currency-appropriate simulated
  net. Creator attribution shows only the owner's display name, never an account
  ID. The entire tile opens its group; there is no separate Open group button.
- The workspace has no app-name/display-name header bar. Pages use a small,
  top-left chevron back button with a 44-point touch target and a spoken
  **Back** label instead of full-width destination-labeled buttons. Nested
  pages return one level at a time; Settings returns to the tab it was opened
  from, and groups opened from Home, Stats, or Search return to that originating page.
  Creating a group from Home or Groups returns to its entry page when backed out
  of; successful creation opens the new group, whose back button returns to that
  same entry page. Draft names and in-flight-save navigation guards are preserved.
  Pressing the bottom **Groups** tab always returns to the main Groups list,
  including repeated presses while already in Groups. It clears the active
  detail/tournament/leaderboard and prevents delayed opens or saves from
  navigating back into a group. Create-group fields remain available when
  reopened; leaving a selected group ends its local child-screen drafts.
- Groups starts with a **Create a new group** button, followed by **Groups you own**
  and then **Groups you joined**. Creator-owned groups appear only in the first
  section, including when the creator is also on the roster. Each section keeps
  the saved group order, with two colored, square-style group buttons per row,
  showing avatars, names, player counts and the same latest-completion date,
  without creator details or leaderboard
  shortcuts. An odd final tile stays half-width within its own section. Each
  empty section shows create/join guidance only after groups have loaded. Long names and
  larger text can grow the cards vertically rather than hiding content.
  Selecting a group opens its existing detail page.
- Group creation opens a separate page asking for a group name. Existing
  validation and private-by-default behavior are unchanged. A successful save
  opens the group unless the user has navigated elsewhere while saving.
  **How it works** appears at the top of the page, above the creation form, not on Home. It explains
  creating a group, adding registered players or guests, and saving game scores.
  The form uses a burnt-orange header with the selected group avatar, separated
  name/avatar/currency sections, a private-by-default note, and a prominent
  Create group button. None remains the default currency; simulated-wager
  disclosures, validation, disabled/busy states, and save behavior are unchanged.
  Back preserves an unfinished name; switching tabs preserves drafts except
  when the Groups tab explicitly exits the selected group to its main list.
  Account changes still reset the local workspace.
- The group's main page starts with its name and a small **Group settings**
  button. All members can open settings to reach **View players**. Visibility,
  avatar changes, join-request review, and admin management are available to owners
  and admins. Transfer and group deletion remain owner-only; ordinary member
  settings never request management-only join-request data.
- Two small **Overview** and **Leaderboard** tiles appear side by side near the
  top. Overview opens a read-only page describing the saved owner, visibility,
  currency, and completed-game activity, with the current registered/guest roster.
  It adds no editable description field. Anonymous deleted-player entries remain
  in history, standings, and the management roster, not this current-player list.
- Group settings matches general Settings: a compact group avatar/name header
  and divided, 44-point-minimum rows below it. Owner/admin lists put **Join requests**
  first with its pending count, followed by **View players**, **Group visibility**,
  **Change group avatar**, **Admins**, and owner-only transfer/deletion rows.
  The public/private icon and status live in the list, not the header.
  Each row opens a separate page; Back returns to the settings list before
  the group's main page, while the bottom Groups tab still returns to the main Groups list.
  Ordinary members see View players and read-only visibility, never management controls.
  Join-request load failures remain visible on the list and its detail page, with pull-to-retry.
  Join requests retain compact paired approval/decline buttons. Visibility changes
  retain their confirmation and reflect only confirmed saves. Avatar selection
  returns to the list after a successful save; failed saves remain on the avatar page.
  Ownership transfer uses a bounded, scrollable member dropdown;
  guests, deleted players, and the current owner are not eligible. Transfer and
  typed DELETE plus final deletion confirmations remain unchanged.
- **Group settings > View players** opens a separate page with compact **Add a player**
  and owner/admin-only **Add a guest player** forms above the roster. Each form
  places its input and Add button on a wrapping row with short help text.
  The compact roster has a blank avatar header and a **Name** header,
  smaller avatars, inline owner/admin labels, alternating rows, and full wrapping
  names/duplicate-name codes or IDs. Clear, red-outlined **Remove** buttons replace
  the minus icons, retaining 44-point minimum touch targets and confirmation.
  Both this roster and Overview show the owner first, followed by admins, then
  regular players, retaining the existing order within each role. Guests and
  anonymous deleted entries remain in the regular-player section where displayed.
  Sorting never changes the saved roster or adds an owner who is not a roster member.
  All members
  can still add verified players. Back returns to settings and preserves the
  player-ID draft. Back from Overview returns to the group's main page.
- **Game Types** follows these top actions, with **Create a single game** and
  **Create a tournament** as colored buttons in the same row. Additional game
  types wrap at two per row. The tournament button opens the tournament
  workspace; the owner and admins can create tournaments, while members can view and score.
- **Game Types > Create a single game** opens a dedicated doubles-game
  page while keeping the bottom navigation available. It contains new-game
  setup and all in-progress games with status, final-score entry, and owner/admin
  cancellation. "Single game" means one casual doubles game, not singles play.
  These started games retain the existing `pending` domain state.
  In-progress casual games use the same two-row avatar/name/score table as
  completed games. Eligible members enter final scores directly in the score
  cell beside each team's names; only **Save final result** is below the table.
  Empty inputs show a dash, not an invented zero score. Read-only pending games
  show **Pending**. No winner or standings result exists until the server saves
  a valid result. Tournament pool and playoff matches use the same inline editor.
- Casual and tournament team-selection grids show each player's current emoji
  (or the smiling default) alongside their name. Selected players have both a
  highlighted choice and checked box. Duplicate-name IDs, two-player team
  limits, cross-team exclusions, and busy-state guards remain unchanged.
  Each casual team and the tournament picker use the same compact layout.
  Full names and duplicate-name IDs wrap rather than being truncated, with
  two equal-width player columns, 12-point names, 22-point avatars, and 6-point
  gaps between choices. Choices retain 44-point minimum touch targets and
  grow for wrapping names/IDs and larger text; an odd last player stays half-width.
  Tournament fixed-team previews also include both players' avatars.
- The overview's bottom **History** section contains only completed games, newest-started
  first, with final scores and owner/admin deletion. Saving a final result
  removes its score-entry card from the game page and puts it into History.
  Each completed entry has two team rows: emoji avatars, both player names,
  and the team's score. The winning team is highlighted and explicitly labeled
  **WINNER**. Casual entries show the currency-appropriate simulated wager per
  player unless the group uses None; tournament entries omit wager metadata. They distinguish
  casual games from tournament pool/playoff/championship matches. Completed
  tournament match cards use the same table. Tapping a completed tournament
  history card opens its tournament; there is no separate **View tournament**
  button on completed cards. Casual result deletion remains a separate,
  owner/admin action. Scoring rules are unchanged.
  History cards are centered at 92% of the available width, capped at 360 points,
  with 8-point padding. Scores use plain 16-point regular-weight text with no
  colored badge; only the winning team's player area receives a soft sage-green
  background, dark-green edge, and matching **WINNER** label. Score columns stay
  neutral for both teams. Casual, tournament, and score-entry tables stack each
  player on a separate line with their avatar rather than slash-separated names.
  Inline score inputs and actions retain at least 44-point touch targets.
  Full game tables wrap long names and duplicate-name IDs rather than hiding them.
  Back navigation between overview and game page preserves unfinished fields;
  changing groups, signing out, or restarting still discards unsaved drafts.

## Public discovery and requests

- Existing and new groups default to private. The owner and admins can explicitly
  make a group public or private.
- Public means searchable by verified, signed-in users, not a public website.
  Search exposes only the group name, group avatar, creator display name, registered-player
  count, and the caller's own membership/request status. It never exposes
  rosters, games, standings, or emails to nonmembers.
- Search is by group-name substring and paginated in batches of 20. Literal
  wildcard characters are treated as text. Private groups are excluded.
- Find a group displays compact, two-column tiles with group avatars, owner
  display names, player counts, and membership/request badges. Tapping a joined
  group's tile opens it without a separate Open group button. Other tiles
  clearly offer Request to join or Request again; pending tiles are disabled
  while awaiting approval. Search, pagination, refresh, and access rules are unchanged.
- Requesting to join does not confer membership. The owner and admins can review
  pending requests and approve/decline them. Approval revalidates the account,
  then adds it once with its current display name.
- A declined user can submit a new request. Repeated/retried requests are
  idempotent; retrying an older request does not undo a creator's decline.
- Switching to private hides the group and blocks new requests but preserves
  existing pending requests for owner/admin review.
- Directly adding a player clears any pending request for that player. Owners
  and existing members are not added twice. Requests and decisions persist in
  Azure; refresh to see changes from other devices.

## Ranking

- Rank played members by total wins descending, then point differential descending.
- Exact ties share a competition rank: 1, 1, 3, 3.
- Losses and simulated totals do not break ranking ties.
- Players without completed games are unranked and displayed after ranked players.
- Each group has independent standings, even when player names match another group.

## Fixed round-robin tournaments

- **Game Types > Create a tournament** opens the tournament directory without
  a group-name heading or persistent pull-to-refresh instruction.
  A styled **Create tournament** tile sits above **In progress** and **Completed**
  sections. Each section shows clickable tournament tiles in two columns,
  with a name, phase, and fixed-team count. Duplicate names also show full IDs.
  Pool games, ready-for-playoffs tournaments, and unfinished playoffs remain
  in progress; only a tournament with a completed championship is completed.
  Clearing the championship or resetting playoffs moves it back to in progress
  when the saved data updates.
- All members can open tournaments and score ready matches. Only the group
  owner and admins can create/manage them; the creation tile is disabled with an
  explanation for other members. Loading failures remain explicit, and pull
  to refresh, draft preservation, and nested back navigation are unchanged.
- The owner or an admin selects 2-8 fixed two-player teams from the group's roster.
  Registered players and guests can be mixed, or every participant can be a guest.
  Each player can appear on only one team in that tournament. Teams lock at
  creation; the creator need not participate.
- There is one pool: every unordered team pairing plays exactly once. A team
  plays at most once per pool round. Odd team counts have resting teams, not
  scored bye games.
- At creation, owners/admins choose one game to **11 or 15** independently for
  round robin and playoffs. The championship can be **one game to 11**, **one
  game to 15**, or **best two of three games to 11**. Only the championship can
  use a series. Every game is win by two with no cap and must stop at its first
  legal win (for example 11-9 or 12-10, not 12-9, for an 11-point game).
  Rules lock at creation. Defaults remain pool to 11 and playoffs/final to 15;
  legacy tournaments without stored options keep those original rules.
- A championship series accepts one game's result at a time, requires two wins,
  and allocates no third game after a 2-0 result. Each game counts separately
  toward group wins, losses, and point differential. Brackets show series games
  won; details/history label each game. A completed first game alone does not
  complete the tournament or remove the current-player cue from the next game.
  Correcting a series explicitly confirms clearing all its results and
  standings effects, then restarts Game 1. Earlier rounds are unaffected.
  Scoring identifies the exact pending game to reject stale drafts.
- Both fixed and rotating pool schedules have separate numbered round sections
  with completion counts and Current round, Locked, or Completed status. New
  scores are accepted only in the earliest unfinished pool round, with all its
  games required before later rounds unlock. Games within a round can be scored
  in any order. Owners/admins have no bypass. Disabled future-round controls
  explain the prerequisite; the shared API domain logic enforces the same rule.
  Clearing an earlier result preserves already-saved later results but re-locks
  unfinished later games. Historical out-of-order results remain readable.
- All teams advance once every pool game is complete. Seeds use pool wins,
  wins in games among the teams tied on pool wins, then overall pool point
  differential. Do not restart head-to-head for a remaining tied subgroup.
  The owner or an admin explicitly confirms the seed order and may reorder only exact
  ties after those criteria.
- Pool standings have five columns: pool rank, team display names, wins,
  losses, and point differential. Each teammate's name is on its own line.
  Ranks use the same existing tie-break sequence;
  exact ties share competition ranks (1, 1, 3), independently of confirmed playoff
  seed order. During the pool they are provisional; before any completed pool
  games all teams share rank 1. Playoff results never change pool ranks.
  The compact visible headers are a blank rank header, **name**, **w**, **l**,
  and **+/-**. Screen-reader labels retain the full meanings. A dark burnt-orange
  header, alternating rows, and highlighted leaders improve scanning; column
  widths expand for larger text and remain horizontally scrollable if needed.
- Single-elimination brackets give the highest seeds any required byes. Winners
  advance automatically and a scored championship determines the winner.
  Byes create no played game and award no individual win, points, or money.
- Tournament details keep the name and a status banner above a four-tab bar.
  **Overview** is first and selected when opening a tournament. It contains the
  format/team count, timestamp, individual-standings/wager explanation, pool
  tie-break rules, schedule information, and bracket/scoring/bye/reset guidance.
  This explanatory text remains read-only for owners and members; no custom
  text field, persistence change, or rule editing is introduced.
  **Pool** shows standings and the generated playoff seed list, with exact-tie
  editing for owners/admins and read-only review for ordinary members.
  When pool play finishes, the banner above the tabs becomes a **Confirm playoff
  seeds** tile with instructions to review/edit in Pool first. Tapping the tile
  confirms the current displayed order and starts playoffs; it is disabled for
  ordinary members and while loading/saving or viewing stale data.
  **Pool Games** shows the pool schedule and score entry, and **Playoff** shows
  the bracket. Tabs change the content on the same page and retain unfinished
  score entries, including when visiting Overview. Action-specific instructions,
  confirmations, empty states, and errors remain next to their controls.
  Pull to refresh still works; failed loads explicitly explain
  how to retry without a permanent instruction above the page.
- An **In progress** banner identifies pool play or playoffs on every tab.
  Awaiting seeds instead shows the clickable confirmation tile described above.
  A saved championship replaces it with a styled **Champions**
  banner: **1st place** is the final winner and **2nd place** is the final loser,
  not the pool ranks or seeds. No third-place result or match is introduced.
  Full team labels retain guest prefixes and duplicate-name IDs. Clearing the
  championship or resetting playoffs restores In progress after the save.
- The **Playoff** tab's rounds run left to
  right with connecting lines: quarterfinals, semifinals, and championship for
  eight teams, or the appropriate smaller bracket for fewer teams. The page
  scrolls horizontally. Future slots identify their feeder matches; only saved
  results populate advancing teams. Byes remain explicit and unscored.
- Tapping a bracket card opens that match's full avatar/name/score table.
  Eligible members enter both scores inside the team rows and save. A match
  with unresolved participants has no score inputs. Back navigation returns
  from match to bracket, then to the tournament directory. Switching tournament
  tabs does not add back-navigation pages; tab navigation preserves drafts.
  A playoff reset removes obsolete match drafts along with the old bracket.
- Pool and playoff detail cards share History's narrow centered layout and
  regular-weight 16-point completed scores, with no score badges. The winning
  team alone receives a sage-green player-area highlight. Bracket teammates
  are stacked without slash separators and use the same plain-score/winner tones.
  A blue **Your current game** cue identifies the logged-in player's currently
  playable unfinished match in pool cards, playoff details, and bracket cards.
  No personal cue appears on completed, locked, unready, bye, or other players'
  matches. Any eligible member may still score an unlocked match.
- Every played pool and playoff result counts toward normal group standings
  and individual statistics. Tournament wagers are always zero.
- Tournament matches are excluded from casual score entry. Completed matches
  appear in group History with a link back to the tournament. Generic game
  scoring/deletion cannot bypass the tournament rules.
- The owner or an admin can clear pool results before playoffs start. To correct a pool
  result after seeding, or an earlier playoff result, explicitly reset all
  playoffs first. This removes only that tournament's playoff games/results and
  their standings effects, retains pool results, and clears the bracket/champion.
  A completed final can be cleared directly because nothing depends on it.
  Group game numbers and regenerated playoff match IDs are never reused.

See [tournament guide](tournaments.md) for setup, correction, and verification.

## Rotating-partner round-robin tournaments

- Setup offers **Fixed teams** (the existing default) and **Rotating partners**.
  Switching formats retains each format's unsaved selections.
- Rotating tournaments accept exactly **4 or 8** distinct active group players,
  including guests. Six is not supported: 15 unique partnerships cannot be
  divided into doubles games using two partnerships each. The creator may sit out.
- Every player partners with every other player exactly once. Four players
  play 3 rounds / 3 games; eight play 7 rounds / 14 games, with two games per round.
  Everyone plays once per round and faces every other player as an opponent twice.
  Participants and the deterministic schedule lock at creation.
- The owner/admin chooses **one game to 11 or 15**, win by two with no cap,
  stopping at the first valid win. Best-of-three is not offered for rotating
  tournaments. The default and legacy target remain 11.
  No playoffs, seed ordering, byes, or wagers are offered.
- Individual standings use only completed games from this tournament:
  wins descending, then point differential descending. Equal wins and
  differential share competition ranks, such as **1, 1, 3**. No head-to-head
  or owner-selected tie-breaker applies. Unplayed players are unranked.
- Details have **Overview**, **Standings**, and **Schedule** tabs with preserved
  score drafts. Overview is first and read-only. The compact standings table
  shows individual names, wins, losses, and signed differential.
- The directory shows participant count and format, not the partnership-catalog
  count. An **In progress** banner remains until all scheduled games are completed.
  The completed banner shows every player ranked 1st or 2nd, including all tied
  leaders; it never invents a second place when competition ranking skips it.
- Existing permissions, server-confirmed saves, revisions, and idempotency apply.
  The owner or an admin can clear any result to correct it, reopening the tournament and
  recalculating tournament/group standings without changing its schedule,
  other results, or game numbers. Generic game endpoints cannot bypass these rules.
- Configurable scoring requires migration 011 and the updated API before use.
  The new configured-creation route is deliberately separate so older APIs
  cannot silently create a tournament with default rules instead of selected ones.

## Group leaderboard

- Each group's main page has a **Leaderboard** tile opening a dedicated
  full-screen page inside the app.
- The page uses the existing derived standings. It shows the
  group name, player and completed-game counts, and each player's rank, wins,
  losses, point differential, and currency-appropriate simulated net (hidden for None).
  Compact cards use a small rank badge, wrapping player name, inline win/loss/
  differential metrics, and a small net row when applicable. Signed green/red/
  neutral colors, duplicate-name IDs, guest labels, and full text are preserved.
- Every player sharing rank 1 appears in the leader highlight; there is no
  arbitrary top-three cutoff or additional tie-breaker. Unplayed members remain
  visible as unranked, after ranked members.
- Empty groups and groups without completed results explain how to get started.
  Pending games never count toward rankings or the completed-game count.
- Returning from the page preserves the selected group, entered form drafts,
  and results. Opening another group's leaderboard does not switch the selected
  group or mix its standings.
- This is an in-app link, not a publicly shareable URL. Saved results come from
  Azure; access is limited to the creator and added members. Money is simulated.

## Result lifecycle

1. Select players and a simulated wager, then start the game.
2. Enter the final score and save once. Completed games cannot be submitted again.
3. A pending game may be canceled with confirmation.
4. A completed result may be deleted with confirmation. Derive every standing
   again from the remaining completed games so that all effects are removed.
5. To correct a result in this prototype, delete it and create a replacement
   game with the intended teams and wager, then record the correct score.

There is no in-place result editor. Completed history displays the most recently
started games first; it does not record completion timestamps.

## Explicit non-goals

- Real-money wagering, deposits, withdrawals, transfers, escrow, or settlement
- Payment-provider or banking integrations
- Invitation codes
- Offline editing and real-time push updates
- Social login and MFA
- Other tournament formats, random partners, forfeits, withdrawals,
  team changes after creation, whole-tournament deletion, singles, or court/time scheduling
- In-place result editing

Real-money payment work requires a separately scoped compliance and provider
assessment; selecting this no-payment prototype does not approve such work.

## Verification

Domain tests cover names, distinct teams, wager/score validation, per-player
calculations, zero-sum results, partner changes, ranking ties, group isolation,
duplicate result prevention, result deletion, and numeric overflow. Leaderboard
regressions cover more than three shared leaders, ties with different losses
and simulated net, and populated groups with matching player names.

Use `npm test`, `npm run test:coverage`, and `npm run typecheck`. iPhone layout,
keyboard entry, selection accessibility, and confirmation dialogs still need
native-device validation. Also check leaderboard links, back navigation, draft
preservation, long names, larger text, and VoiceOver on a physical device;
domain tests and bundle generation are not substitutes.
