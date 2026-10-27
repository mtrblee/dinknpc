# Round-robin tournaments

Choose **Fixed teams** (the existing default) or **Rotating partners** in setup.
Changing formats preserves unsaved player/team selections. Both formats are
created by owners/admins, use group players including guests, and remain wager-free.

## Scoring choices

Choose and lock the scoring rules when creating a tournament:

| Stage | Available formats | Default |
| --- | --- | --- |
| Fixed-team round robin | 1 game to 11 or 15 | 11 |
| Fixed-team playoffs, except the championship | 1 game to 11 or 15 | 15 |
| Fixed-team championship | 1 game to 11, 1 game to 15, or best 2 of 3 games to 11 | 1 game to 15 |
| Rotating partners | 1 game to 11 or 15 | 11 |

Every game is win by two with no cap and must stop at its first legal winning
score. Rules cannot be changed after creation. Existing tournaments without
saved scoring options retain their original 11-point pools/rotating games and
15-point playoff/championship games.

A best-of-three championship records one game at a time. The next game appears
only after the previous score is saved; a 2-0 series creates no third game.
Champions appear only after a team wins two games. The bracket shows games won,
and match details/history identify Game 1, 2 and, when needed, 3. Every played
game contributes its own wins, losses and point differential to group standings.
The owner's/admin's **Clear series to correct scores** action explicitly confirms
clearing the entire series, including its standings effects, and restarting at
Game 1. Reset all playoffs also removes every championship-series game.

The approved development migration/API rollout is in progress; see
[configurable tournament scoring](azure.md#configurable-tournament-scoring).
Use the updated Expo Go client for these formats. Older TestFlight clients do
not understand configurable targets or multi-game championships.

## Round progression and your game

Pool Games (or Schedule for rotating partners) separates matches into numbered
round sections, each with a completion count and **Current round**, **Locked**,
or **Completed** status. Only the earliest unfinished pool round accepts new
scores. All its games must finish before the next round unlocks; games within
that round can be scored in any order. The rule applies to owners and admins
as well as members and is checked by the shared domain logic inside the API's
existing transaction. There is no administrative bypass.

Future-round inputs and Save controls are disabled with an explanation, without
pretending a save is in progress. Existing later-round results remain readable.
Clearing an earlier result preserves later results but re-locks unfinished later
games until the earlier round is repaired. Saved schedules and game IDs do not change.

The authenticated player's unfinished, currently playable match receives a blue
**Your current game** cue in pool cards, playoff match details, and the bracket.
Completed games, locked future rounds, unresolved bracket slots, byes, and games
without that player are not personally highlighted. Resting teams wait for the
next pool round. This cue does not change scoring permissions: any eligible
group member can still record a currently unlocked game's result.

Every pool/playoff game card and bracket node shows **Ready to play**, **Waiting**,
or **Completed**. Waiting includes locked pool rounds and unresolved playoff
opponents. The personal blue cue appears alongside readiness, not instead of it.
Byes say **Advances by bye**, never implying a played/completed game.
Completed pool/playoff details share History's compact width, stacked names,
regular neutral scores, and sage winner-only highlighting. Known teams in
unresolved match details also stack their names.

Registered display names use the latest synced profile, including saved games,
standings, brackets, and both setup formats. Existing team/player selections
stay keyed by ID. Refreshing tournaments updates the shared group roster even
when its game revision is unchanged; changing a local name also refreshes
already-mounted tournament labels without discarding drafts.

The updated API was deployed and independently verified on 2026-10-27;
server-side round enforcement now applies to older clients too. No schema
migration was needed. See the [API rollout record](azure.md#pool-round-enforcement-rollout-2026-10-27-utc)
for checks and limitations. Reload Expo Go for the new presentation. TestFlight
1.0.1 (3) predates these tournament UI changes and still needs a later approved
native release to display round sections, disabled future inputs, and personal cues.

## Rotating partners

Select exactly **4 or 8** active players, then create the schedule:

| Players | Rounds | Games per round | Total games | Games per player |
| --- | --- | --- | --- | --- |
| 4 | 3 | 1 | 3 | 3 |
| 8 | 7 | 2 | 14 | 7 |

Every player partners with every other player exactly once, plays once per round,
and faces each other player twice as an opponent. Six players are unsupported:
their 15 partnerships cannot form whole doubles games with two partnerships each.
Selection stops at eight. Removed/deleted draft participants require replacements;
saved schedules cannot be changed. Existing anonymous participants remain in history.

Games use the selected **11 or 15, win by two, no cap**, with no playoffs. Individual standings use
only this tournament's completed games, ordered by **wins**, then **point
differential**. Exact ties share competition ranks (**1, 1, 3**); there is no
head-to-head tie-break or owner seed ordering. Unplayed participants are unranked.
Played games also count toward the usual group leaderboard.

The tabs are **Overview**, **Standings**, and **Schedule**. Overview is first and
read-only; tabs retain unfinished scores. The directory shows 4/8 **players** and
the rotating format, not the 6/28 stored partnerships. All scheduled games must
finish before the In progress banner becomes Champions. The banner shows every
player ranked 1st or 2nd, including all tied leaders. When shared ranks skip 2nd,
no second place is invented.

Only the owner or an admin can clear a result. Clearing any rotating result reopens the
tournament and recalculates standings, preserving the other results, game IDs,
schedule, and original creation date. Completion time is the latest recorded
game completion, including corrections to earlier games. Historical out-of-order
results remain valid, but new scores follow round progression. Unknown historical
completion timestamps stay unknown. There are no simulated wagers in any currency.

## Fixed teams

### Use the feature

1. Open a group, then **Game Types > Create a tournament**. Below its **Create tournament** tile,
   **In progress** and **Completed** show two clickable tournament tiles per row.
   Tiles show the name, phase, and fixed-team count; matching names also show IDs.
2. The owner or an admin chooses the **Create tournament** tile, enters a name, and selects
   pairs of group players using **Add fixed team**. Before setup, the owner/admin can
   save participants without accounts in **View players > Add a guest player**,
   then select them like any other player.
   Guests stay on the group's roster and display **(g)** before their names.
   A compact two-column player picker and fixed-team previews show each player's current emoji
   and display name, with a smiling default if no avatar has been chosen.
   Smaller names/avatars and tighter spacing fit more players on screen, while
   full names and duplicate-name IDs wrap and touch targets remain at least 44 points.
   Selected choices are highlighted with a checked box; already assigned players cannot be reused.
   Ordinary members see the creation tile disabled, but can open existing tournaments.
   They cannot add guests or remove players; those are owner/admin roster actions.
3. Review the 2-8 teams before creating the pool schedule. Every player must be
   on exactly one selected team; other group members may sit out. Teams cannot
   be changed after creation. Identically named tournaments remain separate by ID.
   Mixed registered/guest teams and all-guest tournaments use the same scoring,
   ranking, and distinct-player rules. Guests cannot log in or score results themselves.
   Players referenced by a saved tournament cannot be removed, even after completion.
   If someone is removed before a draft is saved, affected fixed-team drafts must be
   removed and recreated with available players; unrelated drafts are retained.
4. Open the tournament on the first tab, **Overview**. This read-only tab contains
   the format/team count, timestamps, individual-standings explanation, pool
   ranking rules, schedule information, and bracket guidance. Overview text
   is not editable by owners or members in this version.
   Use **Overview**, **Pool**, **Pool Games**, and **Playoff** to switch content
   on the same page beneath the status banner.
   **Pool** contains the compact standings table with a blank rank
   header followed by **name**, **w**, **l**, and **+/-** (point differential).
   Each teammate's display name is on its own line. Under **Pool Games**, any member
   can enter final scores in a match from the current unlocked round, then choose **Save final result**.
   Pool games use their saved 11- or 15-point target, win by two, with no cap.
5. After all pool games finish, the status banner above the tabs becomes a
   **Confirm playoff seeds** tile. Its instructions direct everyone to **Pool**
   to review the generated seed list. Only the owner or an admin can reorder
   exact ties; ordinary members see the seed list read-only.
   The owner or an admin taps the tile to confirm the displayed order and start
   playoffs, even if no teams moved. The tile uses edits made in Pool, including
   after switching tabs, and is disabled during loading/saving or while data is
   stale. The former confirmation button inside Pool is removed.
6. Choose **Playoff**. The bracket runs left to right:
   **Quarterfinals > Semifinals > Championship** for eight teams, with fewer
   rounds for smaller fields. Swipe horizontally to follow the connecting lines.
7. Tap a bracket match to open its full game table. Enter scores in the cells
   beside the team names and choose **Save final result**. Playoffs and the
   championship use their saved scoring choices; each game is win by two with
   no cap. In a best-of-three final, save each game separately. Saved match winners
   populate the next round automatically. After the saved final, the gold-and-silver
   **Champions** banner displays the championship winner in **1st place** and
   the championship loser in **2nd place**, with full team/player labels.
   Unresolved matches show their feeder matches instead of editable scores,
   and byes have no score entry.

Pool games, tournaments waiting for playoff seeds, and unfinished playoffs
appear under **In progress**. The detail page also shows an **In progress**
banner with the current phase, on every tab, except that awaiting seeds shows
the confirmation tile. The saved final replaces the status
with Champions. Only a completed championship puts a tournament
under **Completed**. Clearing that result or resetting playoffs returns it to
**In progress** and restores its banner once the saved snapshot updates.
Placements come from the championship result, not pool standings or playoff
seeds. Only first and second are displayed. Each section has its own empty
state after a successful load; a loading failure is never shown as an empty list.

Games and tournament tiles/details show **Created** date/time while in progress
and **Completed** date/time after saving the result. Tournament completion uses
the championship's completion time. Times persist in UTC and display in the
device's local time zone. Historical dates that were never saved show **Time
unavailable**, not an invented date. Clearing a result restores the original
creation timestamp; resaving records a new completion time. A playoff reset
keeps the tournament's original creation date. Future bracket slots and byes
have no played-game timestamp; actual playoff games get one when both teams are known.

Pool and playoff detail cards use the same narrow, centered layout as History:
92% of available width, at most 360 points, with 8-point padding. Each teammate
has a separate line and avatar. Completed scores use regular-weight 16-point
text with no score badges; only the winner's player area has a sage-green
background and dark-green edge. The bracket also stacks teammates and uses
plain scores and sage-green winning teams, retaining its existing compact
geometry and feeder connections. It expands vertically with larger text.
Tap a bracket card for full, wrapping player names and inline score controls.
Score inputs and action buttons retain their 44-point minimum touch targets.

The round-robin schedule gives each pairing one game, with no team scheduled
twice in a round. With an odd team count, a team rests each round. Rounds are a
pairing guide, not booked courts/times: games in the current unlocked round can
be played in parallel, and all must finish before later-round score entry.
There is no best-of series or third-place match.

Pull down to refresh for other members' changes or retry a failed tournament
load, even when the group revision has not changed. There is no refresh button,
group-name directory header, or permanent refresh instruction. Retry guidance
appears only when a load fails.
Completed tournament games in the group's bottom **History** section are
themselves tappable and open the tournament without a separate button.
Group-level revisions
protect scores, seeds, and resets against concurrent changes. Back navigation
and the bottom tabs remain available; score/save errors are displayed explicitly.
The small top-left back icon returns from match details to the bracket, then
to the tournament directory. The four tab panels stay mounted to preserve
unfinished score entries; choosing **Playoff** also returns from match details
to the bracket. Changing tournaments/groups, signing out, or resetting
the bracket can discard the corresponding drafts. No live push updates are added.

## Scoring and standings

Valid pool examples: 11-0, 11-9, 12-10, 18-16. Invalid examples: 10-0, 11-10,
12-9, or a tied score. Playoff equivalents use 15 as the target: 15-13 and 16-14
are valid, but 15-14 is not. All values still must be safe nonnegative integers.
Casual doubles-game rules are unchanged.

Pool seeds are determined by:

1. Total pool wins, descending.
2. Wins against the teams tied on total pool wins.
3. Overall pool point differential, descending.
4. The owner or an admin's explicit choice for any remaining exact tie.

Head-to-head is evaluated once within the original pool-wins tie set. It is not
restarted after some teams separate. For example, a three-team head-to-head
cycle can leave two teams tied after differential; the owner/admin then orders
those two rather than reapplying their individual head-to-head result.

The table's pool ranks use the first three criteria above. Exact ties share
competition ranks (for example, 1, 1, 3); they do not acquire distinct pool
ranks just because the owner/admin assigns distinct playoff seeds. Ranks are
provisional while pool games remain, with all teams tied at 1 before the
first result. Playoff scores do not change pool ranks.

All teams qualify. A conventional seeded bracket places seeds 1 and 2 in
opposite halves and awards byes to the highest seeds when the team count is not
a power of two. Exactly `N - 1` played playoff games determine the champion.
Byes do not create game records or add wins to group standings.

Played tournament games contribute normal per-player wins, losses, and team
point differential to the group leaderboard. Every tournament wager is zero.
Pool seeding uses only that tournament's pool results, not earlier casual games
or playoff results. A tournament champion is not necessarily the group's
overall individual standings leader.

## Correct results safely

Only the owner or an admin can clear results or reset playoffs.

- Before playoffs begin, **Clear result to correct score** returns a completed
  pool game to pending, removes its standings effects, and allows a new score.
- After playoffs begin, use **Reset all playoffs** before changing pool results
  or results from an earlier playoff round. The confirmation explains that all
  playoff/championship games and their statistics will be removed.
- Pool results, casual games, and other tournaments are preserved. Correct any
  pool result, finish the pool again, and reconfirm seeds to rebuild the bracket.
- A championship result can be cleared directly because there is no later
  match to invalidate.

Resets are transactional. They do not reuse old game numbers or playoff match
identifiers, and they reject unsafe recalculated group totals. Normal game
delete/score endpoints reject tournament-linked games; use tournament controls
instead. Individual match cancellation/forfeits, changing fixed teams, and
deleting an entire tournament are not implemented in this first version.

## Storage and deployment

[003_tournaments.sql](../api/sql/003_tournaments.sql) adds a group-scoped
`Tournaments` table, optional tournament links on `Games`, and tournament IDs on
idempotency receipts. Existing games remain ordinary games with null links.

Tournament state is a bounded JSON document. Fixed tournaments have at most 8
teams, 28 pool matches, and 7 bracket nodes. Rotating tournaments have at most
8 participants, 28 unique partnership records, 14 pool-stage matches, and no
bracket or seeds. Pure TypeScript logic validates its shape, participant membership,
distinct partnerships, round appearances, bracket dependencies, seeds, game links, and scores. Played and ready
matches use normal game rows; unresolved bracket slots and byes have no game row.
SQL also checks tournament stages, zero wagers, legal final scores, unique
match links, and group/tournament foreign keys.

The API updates the document, linked game rows, group revision/counter, and
idempotency receipt in one transaction. It returns a consistent group/tournament
collection snapshot. Creation uses a stable idempotency key without a group
revision, so unrelated group updates do not turn a retry into a duplicate
tournament. All subsequent changes require the group's quoted `If-Match` version.

Rotating support requires deploying the updated API before using the new client
format. Existing fixed-tournament requests and documents remain compatible.
Older clients cannot decode rotating documents, so update all participating
clients before creating one in a shared group. No rotating-specific migration,
dependency, or service is needed. Deployment is a separate, explicitly approved action.

For initial database setup, run approved migrations before deploying the API.
Live SQL tests write synthetic fixtures and require explicit authorization:

```powershell
npm run migrate --prefix api
npm test
npm run typecheck
$env:RUN_SQL_INTEGRATION = '1'
npm run test:sql --prefix api
```

Use the Azure connection variables and managed-identity **client ID** described
in [Azure setup](azure.md). The runtime gets only SELECT/INSERT/UPDATE on the
tournament table, not database-owner privileges. No new Azure service is needed.

HTTP routes, under `/api/groups/{groupId}/tournaments`:

| Method/path | Access |
| --- | --- |
| `GET /` | Group members; consistent group/tournament snapshot |
| `POST /` | Owner/admin; name and format-specific participants (below), no wager fields |
| `POST /{id}/matches/{matchId}/result` | Members; final score, target enforced by match stage |
| `DELETE /{id}/matches/{matchId}/result` | Owner/admin; safe result correction only |
| `POST /{id}/playoffs` | Owner/admin; fixed format only, confirmed seed order, all pool games complete |
| `DELETE /{id}/playoffs` | Owner/admin; fixed format only, reset the playoff bracket and results |

Creation bodies use either `style: "fixed-round-robin"` with `teams` (2-8
two-player ID arrays), or `style: "rotating-partner-round-robin"` with `players`
(exactly 4 or 8 distinct player IDs). Both require a nonempty `name`. Mixing
`teams` and `players`, unsupported counts/styles, and wager fields is rejected.

All mutations require an `Idempotency-Key`; only creation omits `If-Match`.
The generic group-game endpoints cannot score or delete a tournament match.
Public-group discovery still reveals no tournament roster or results to nonmembers.

## Verification

Domain tests cover every size from 2 to 8, all pool pairings, round rests,
winning-score boundaries, multi-team ties/no restart, owner seed order, highest
seed byes, exact playoff game counts, champion progression, immutability,
corrections, and numeric overflow. API/client tests cover permissions, bypasses,
snapshot validation, and creation retries across unrelated group changes.
Pure layout tests cover every supported bracket size, left-to-right placement,
centered feeder connections, larger text scaling, byes, empty/reset brackets,
and saved-winner progression. Component checks are not native-device UI tests;
verify horizontal scrolling, inline numeric keyboards, back navigation, and
draft preservation on an iPhone.

Rotating tests cover both supported sizes, exact partnership/opponent counts,
one appearance per round, invalid participant lists, shared individual ranks,
isolation from casual games/other tournaments, all currencies, guest/anonymous
history, historical completion timestamps, resets, forbidden playoffs, malformed
saved documents, permissions, and retry-safe format-specific API bodies. Round
tests cover every fixed-team count and both rotating sizes, partial-round locks,
out-of-order scoring within a round, owner/admin/member rejection, preservation
of historical results, re-locking after corrections, and personal match cues.
They also check ready/waiting/completed states through pool progression,
historical results and corrections, playoff dependencies, championships, and byes.
Profile/cache/store regressions cover current registered names, preserved
guest/anonymous labels, unchanged results/revisions, explicit partial-save errors,
account isolation, and protection against older in-flight profile data.

The live SQL tests use synthetic accounts in the development database, verify
an eight-team event through its championship, concurrent scoring, SQL score
constraints, independent-connection persistence, resets and permissions, and
clean up only their fixtures in explicit write transactions.
They also exercise both rotating sizes, independent reloads, idempotent creation,
round-ordered completion with reversed game order within each round, rejection
of future-round scores without a saved revision change, rejected playoffs/stale/member resets, and result
correction without changing unrelated games. These checks are not part of `npm test`
and must not be represented as passing without an approved live run.

On an iPhone, also verify owner versus member controls, selecting fixed pairs,
invalid score feedback, pool results entering History/statistics, manual tie
ordering, a non-power-of-two bracket (such as three teams), byes without scored
wins, championship display, and the reset confirmations. Native layout and
interaction are not verified by domain tests or JavaScript bundling.
