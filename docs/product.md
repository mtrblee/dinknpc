# Group standings prototype

## Purpose

DinkNPC tracks scores and individual rankings among members of player-created
pickleball groups. It is not currently a tournament scheduling app.

## Approved prototype scope

- Groups and player names are created locally, without accounts or sharing.
- All state is in memory. Restarting the app discards all groups and results;
  the UI must prominently disclose this.
- Names are trimmed, nonempty, and case-insensitively unique within their
  scope: group names across the local app, and player names within a group.
- A doubles game uses exactly four distinct members of the selected group.
  Partners can change between games. Singles are not supported.
- Before score entry, a game is started with fixed teams and a fixed
  simulated wager per player, in USD. Pending games do not affect standings.
- Wagers may be zero and must be nonnegative dollar amounts with at most two
  decimal places. Store them as integer cents, never fractional dollars.
- Completed scores must be nonnegative whole numbers and cannot be tied.
  No target score, score cap, or win-by-two rule is enforced in this prototype.
- Reject values or accumulated totals outside JavaScript's safe integer range.
  Invalid input leaves all existing results and totals unchanged.

## Per-player calculations

Only completed games count:

- A player on the winning team receives one win; a losing player receives one loss.
- Each player's point differential increases by their team's score minus the
  opposing team's score. This is a team-score differential attributed to each
  player, not individually scored points.
- Each winner gains the simulated per-player wager; each loser loses it.
  A $5 doubles game produces +$5 for each winner and -$5 for each loser, not a
  $5 team pot. The total money change across the four players is zero.
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

## Ranking

- Rank played members by total wins descending, then point differential descending.
- Exact ties share a competition rank: 1, 1, 3, 3.
- Losses and simulated money do not break ranking ties.
- Players without completed games are unranked and displayed after ranked players.
- Each group has independent standings, even when player names match another group.

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
- Accounts, permissions, invitations, or multi-device synchronization
- Persistent storage or recovery after restart
- Tournament scheduling, brackets, singles, or automatic pairings
- In-place result editing or deleting groups/players

Real-money payment work requires a separately scoped compliance and provider
assessment; selecting this no-payment prototype does not approve such work.

## Verification

Domain tests cover names, distinct teams, wager/score validation, per-player
calculations, zero-sum results, partner changes, ranking ties, group isolation,
duplicate result prevention, result deletion, and numeric overflow.

Use `npm test`, `npm run test:coverage`, and `npm run typecheck`. iPhone layout,
keyboard entry, selection accessibility, and confirmation dialogs still need
native-device validation; domain tests and bundle generation are not substitutes.
