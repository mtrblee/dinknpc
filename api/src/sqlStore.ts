import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { addPlayer, createGroup, getStandings, removePlayer, validateCurrency, validatePlayerCode } from '../../src/domain/groups.ts';
import type { Game, Group, Player, Team } from '../../src/types/groups.ts';
import { mayChangeGroup } from '../../src/types/api.ts';
import type { AccountDeletionStatus, GroupLifecycleReceipt, PublicGroup, SavedGroup } from '../../src/types/api.ts';
import { ApiError, applyCommand } from './contracts.ts';
import type { GroupStore } from './contracts.ts';
import { changeTournament, createRotatingTournament, createTournament, parseTournament, tournamentCompletedAt } from '../../src/domain/tournaments.ts';
import { parseTournamentGameScoring } from '../../src/domain/tournamentScoring.ts';
import type { Tournament } from '../../src/types/tournaments.ts';
import { DEFAULT_AVATAR, validateAvatar } from '../../src/domain/avatars.ts';
import { DEFAULT_GROUP_AVATAR, validateGroupAvatar } from '../../src/domain/groupAvatars.ts';
import { anonymizeParticipant } from '../../src/domain/accountDeletion.ts';
import { changeGroupAdmin, createOwnedGroup } from '../../src/domain/groupRoles.ts';
import { generatePlayerCode } from './playerCodes.ts';

type GroupRow = { id: string; owner_id: string; owner_name: string; name: string; currency: string; avatar: string;
  counter: string; revision: Buffer; is_public: boolean };
type MemberRow = { player_id: string; code: string | null; display_name: string; avatar: string; is_guest: boolean; is_deleted: boolean; is_admin: boolean };
type GameRow = {
  id: string; status: string; wager: string;
  team_a1: string; team_a2: string; team_b1: string; team_b2: string;
  score_a: string | null; score_b: string | null;
  tournament_id: string | null; tournament_match_id: string | null; tournament_stage: string | null;
  tournament_target: number | null; tournament_game_number: number;
  created_at: Date | null; completed_at: Date | null;
};

function integer(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new Error('Stored integer is invalid.');
  return number;
}
async function transaction<T>(pool: sql.ConnectionPool, isolation: number, work: (tx: sql.Transaction) => Promise<T>, attempt = 0): Promise<T> {
  const tx = new sql.Transaction(pool);
  let rolledBack = false;
  tx.on('rollback', () => { rolledBack = true; });
  await tx.begin(isolation);
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    if (!rolledBack) {
      try { await tx.rollback(); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'The database transaction failed.'); }
    }
    if (error instanceof sql.RequestError && error.number === 1205 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      return transaction(pool, isolation, work, attempt + 1);
    }
    if (error instanceof sql.RequestError && (error.number === 2601 || error.number === 2627) &&
        error.message.includes('PK_PlayerCodes')) {
      if (attempt < 7) return transaction(pool, isolation, work, attempt + 1);
      throw new ApiError(503, 'player_code_unavailable', 'Could not allocate a unique player code. Please retry.');
    }
    throw error;
  }
}
function accountHash(id: string): Buffer {
  return createHash('sha256').update(`dinknpc-deleted-account:${id.toLowerCase()}`).digest();
}
async function assertNotDeleting(tx: sql.Transaction, id: string) {
  const result = await new sql.Request(tx).input('hash', sql.VarBinary(32), accountHash(id))
    .query('SELECT id FROM dbo.AccountDeletions WITH (UPDLOCK, HOLDLOCK) WHERE account_hash = @hash;');
  if (result.recordset.length) throw new ApiError(403, 'account_deleting', 'Account deletion has been requested. This account can no longer access saved data.');
}
async function activeTransaction<T>(pool: sql.ConnectionPool, actor: Player, isolation: number, work: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  return transaction(pool, isolation, async (tx) => {
    await assertNotDeleting(tx, actor.id);
    const row = (await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
      .query<{ is_guest: boolean; is_deleted: boolean }>('SELECT is_guest, is_deleted FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE id = @actor;')).recordset[0];
    if (!row || row.is_guest || row.is_deleted || actor.isGuest || actor.isDeleted) {
      throw new ApiError(403, 'account_required', 'An active registered account is required.');
    }
    return work(tx);
  });
}
async function syncPlayer(tx: sql.Transaction, player: Player): Promise<Player> {
  if (player.isGuest || player.isDeleted) throw new ApiError(403, 'account_required', 'An active registered account is required.');
  await assertNotDeleting(tx, player.id);
  const result = await new sql.Request(tx).input('id', sql.UniqueIdentifier, player.id)
    .input('name', sql.NVarChar(sql.MAX), player.name)
    .input('avatar', sql.VarChar(16), validateAvatar(player.avatar ?? DEFAULT_AVATAR)).query<{ is_guest: boolean; is_deleted: boolean }>(`
      SELECT is_guest, is_deleted FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
      UPDATE dbo.Players SET display_name = @name, avatar = @avatar WHERE id = @id AND is_guest = 0 AND is_deleted = 0;
      IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE id = @id)
        INSERT dbo.Players(id, display_name, avatar) VALUES (@id, @name, @avatar);`);
  if (result.recordset[0]?.is_guest || result.recordset[0]?.is_deleted) throw new ApiError(403, 'account_required', 'An active registered account is required.');
  const codes = await new sql.Request(tx).input('id', sql.UniqueIdentifier, player.id)
    .input('code', sql.VarChar(6), generatePlayerCode()).query<{ code: string }>(`
      IF NOT EXISTS (SELECT 1 FROM dbo.PlayerCodes WHERE player_id = @id)
        INSERT dbo.PlayerCodes(code, player_id) VALUES (@code, @id);
      SELECT code FROM dbo.PlayerCodes WHERE player_id = @id;`);
  const code = codes.recordset[0]?.code;
  if (!code) throw new Error('The saved player code was not returned.');
  return { ...player, code: validatePlayerCode(code) };
}
async function load(tx: sql.Transaction, actor: Player, id: string, locking = false): Promise<SavedGroup> {
  const result = await new sql.Request(tx).input('id', sql.UniqueIdentifier, id).query<GroupRow>(`
    SELECT g.id, g.owner_id, p.display_name AS owner_name, g.name, g.currency, g.avatar,
      CONVERT(varchar(32), g.next_game_number) AS counter, g.revision, g.is_public
    FROM dbo.Groups g ${locking ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    JOIN dbo.Players p ON p.id = g.owner_id WHERE g.id = @id;`);
  const row = result.recordset[0];
  if (!row) throw new ApiError(404, 'group_not_found', 'This group was not found.');
  const members = await new sql.Request(tx).input('id', sql.UniqueIdentifier, id)
    .query<MemberRow>(`SELECT m.player_id,
      CASE WHEN p.is_guest = 1 OR p.is_deleted = 1 THEN m.name_snapshot ELSE p.display_name END AS display_name,
      p.avatar, p.is_guest, p.is_deleted, m.is_admin, c.code
      FROM dbo.GroupMembers m JOIN dbo.Players p ON p.id = m.player_id
      LEFT JOIN dbo.PlayerCodes c ON c.player_id = p.id AND p.is_guest = 0 AND p.is_deleted = 0
      WHERE m.group_id = @id ORDER BY m.position;`);
  const players = members.recordset.map((member) => ({
    id: member.player_id.toLowerCase(), name: member.display_name, avatar: validateAvatar(member.avatar),
    ...(member.is_guest ? { isGuest: true } : {}),
    ...(member.is_deleted ? { isDeleted: true } : {}),
    ...(member.code == null ? {} : { code: validatePlayerCode(member.code) }),
  }));
  const isOwner = row.owner_id.toLowerCase() === actor.id;
  const admins = members.recordset.filter(member => member.is_admin);
  if (admins.some(member => member.is_guest || member.is_deleted || member.player_id.toLowerCase() === row.owner_id.toLowerCase())) {
    throw new Error('Stored group admin membership is invalid.');
  }
  const adminIds = admins.map(member => member.player_id.toLowerCase());
  const canManage = isOwner || adminIds.includes(actor.id);
  if (actor.isGuest || actor.isDeleted || (!isOwner && !players.some((player) => player.id === actor.id && !player.isGuest && !player.isDeleted))) {
    throw new ApiError(404, 'group_not_found', 'This group was not found.');
  }
  const gamesResult = await new sql.Request(tx).input('id', sql.UniqueIdentifier, id).query<GameRow>(`
    SELECT id, status, CONVERT(varchar(32), wager_cents) AS wager, team_a1, team_a2, team_b1, team_b2,
      CONVERT(varchar(32), score_a) AS score_a, CONVERT(varchar(32), score_b) AS score_b,
      tournament_id, tournament_match_id, tournament_stage, tournament_target, tournament_game_number, created_at, completed_at
    FROM dbo.Games WHERE group_id = @id ORDER BY game_number;`);
  const games: Game[] = gamesResult.recordset.map((game) => {
    const teamA: Team = [game.team_a1.toLowerCase(), game.team_a2.toLowerCase()];
    const teamB: Team = [game.team_b1.toLowerCase(), game.team_b2.toLowerCase()];
    let tournament: Game['tournament'];
    if (game.tournament_id !== null) {
      if (!game.tournament_match_id || (game.tournament_stage !== 'pool' && game.tournament_stage !== 'playoff' && game.tournament_stage !== 'championship')) throw new Error('Invalid tournament game metadata.');
      tournament = { id: game.tournament_id.toLowerCase(), matchId: game.tournament_match_id, stage: game.tournament_stage,
        ...parseTournamentGameScoring({ stage: game.tournament_stage,
          ...(game.tournament_target == null ? {} : { targetScore: game.tournament_target }),
          ...(game.tournament_game_number === 0 ? {} : { gameNumber: game.tournament_game_number }) }) };
    }
    const setup = { id: game.id, teamA, teamB, wagerUnits: integer(game.wager), tournament,
      createdAt: game.created_at?.toISOString() ?? null, completedAt: game.completed_at?.toISOString() ?? null };
    if (game.status === 'pending') return { ...setup, status: 'pending' };
    if (game.status !== 'completed' || game.score_a === null || game.score_b === null) throw new Error('Stored game is invalid.');
    return { ...setup, status: 'completed', scoreA: integer(game.score_a), scoreB: integer(game.score_b) };
  });
  const group = {
    id: row.id.toLowerCase(), name: row.name, players, games, nextGameNumber: integer(row.counter),
    currency: validateCurrency(row.currency), avatar: validateGroupAvatar(row.avatar),
    ownerId: row.owner_id.toLowerCase(), ownerName: row.owner_name, revision: row.revision.toString('hex'),
    canEdit: true, canManage, isOwner, adminIds, isPublic: row.is_public,
  };
  try { getStandings(group); }
  catch (cause) { throw new Error('Stored standings are invalid.', { cause }); }
  return group;
}
async function replay(tx: sql.Transaction, actor: Player, requestId: string, fingerprint: string): Promise<{ groupId: string; tournamentId: string | null } | null> {
  const lifecycle = (await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
    .input('request', sql.UniqueIdentifier, requestId)
    .query<{ action: string }>('SELECT action FROM dbo.GroupLifecycleMutations WITH (UPDLOCK, HOLDLOCK) WHERE actor_id = @actor AND request_id = @request;')).recordset[0];
  if (lifecycle) throw new ApiError(lifecycle.action === 'retired' ? 410 : 409, 'request_retired',
    lifecycle.action === 'retired' ? 'The group for this saved request was deleted. It will not be recreated by retrying.' : 'This request ID belongs to another operation.');
  const result = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
    .input('request', sql.UniqueIdentifier, requestId).query<{ group_id: string; fingerprint: string; tournament_id: string | null }>(`
      SELECT group_id, fingerprint, tournament_id FROM dbo.Mutations WITH (UPDLOCK, HOLDLOCK)
      WHERE actor_id = @actor AND request_id = @request;`);
  const previous = result.recordset[0];
  if (!previous) return null;
  if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'request_reused', 'This request ID was already used for a different change.');
  return { groupId: previous.group_id.toLowerCase(), tournamentId: previous.tournament_id?.toLowerCase() ?? null };
}
async function remember(tx: sql.Transaction, actor: Player, id: string, requestId: string, fingerprint: string, tournamentId: string | null = null) {
  await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id).input('id', sql.UniqueIdentifier, id)
    .input('request', sql.UniqueIdentifier, requestId).input('fingerprint', sql.Char(64), fingerprint)
    .input('tournament', sql.UniqueIdentifier, tournamentId)
    .query('INSERT dbo.Mutations(actor_id, request_id, fingerprint, group_id, tournament_id) VALUES (@actor, @request, @fingerprint, @id, @tournament);');
}
async function saveChanges(tx: sql.Transaction, previous: Group, next: Group, isPublic: boolean) {
  const removed = previous.players.filter((player) => !next.players.some((entry) => entry.id === player.id));
  for (const player of removed) {
    await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('player', sql.UniqueIdentifier, player.id)
      .input('local', sql.Bit, player.isGuest === true || player.isDeleted === true).query(`
        DELETE dbo.GroupMembers WHERE group_id = @group AND player_id = @player;
        IF @local = 1 DELETE dbo.Players WHERE id = @player AND (is_guest = 1 OR is_deleted = 1);`);
  }
  for (const [position, player] of next.players.entries()) {
    if (previous.players.some((entry) => entry.id === player.id)) {
      if (removed.length) {
        // Compact in roster order so later additions cannot collide with a surviving position.
        await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('player', sql.UniqueIdentifier, player.id)
          .input('position', sql.Int, position)
          .query('UPDATE dbo.GroupMembers SET position = @position WHERE group_id = @group AND player_id = @player;');
      }
      continue;
    }
    if (player.isGuest) {
      await new sql.Request(tx).input('id', sql.UniqueIdentifier, player.id).input('name', sql.NVarChar(sql.MAX), player.name)
        .input('avatar', sql.VarChar(16), DEFAULT_AVATAR)
        .query('INSERT dbo.Players(id, display_name, avatar, is_guest) VALUES (@id, @name, @avatar, 1);');
    } else await syncPlayer(tx, player);
    await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('player', sql.UniqueIdentifier, player.id)
      .input('name', sql.NVarChar(sql.MAX), player.name).input('position', sql.Int, position)
      .query(`INSERT dbo.GroupMembers(group_id, player_id, name_snapshot, position) VALUES (@group, @player, @name, @position);
        DELETE dbo.GroupJoinRequests WHERE group_id = @group AND player_id = @player;`);
  }
  let nextNumber = previous.nextGameNumber;
  for (const game of next.games) {
    const before = previous.games.find((entry) => entry.id === game.id);
    if (!before) {
      await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('id', sql.NVarChar(80), game.id)
        .input('number', sql.BigInt, nextNumber++).input('a1', sql.UniqueIdentifier, game.teamA[0])
        .input('a2', sql.UniqueIdentifier, game.teamA[1]).input('b1', sql.UniqueIdentifier, game.teamB[0])
        .input('b2', sql.UniqueIdentifier, game.teamB[1]).input('wager', sql.BigInt, game.wagerUnits)
        .input('tournament', sql.UniqueIdentifier, game.tournament?.id ?? null)
        .input('match', sql.NVarChar(80), game.tournament?.matchId ?? null).input('stage', sql.VarChar(12), game.tournament?.stage ?? null)
        .input('target', sql.TinyInt, game.tournament?.targetScore ?? null)
        .input('seriesGame', sql.TinyInt, game.tournament?.gameNumber ?? 0)
        .query(`INSERT dbo.Games(group_id, id, game_number, team_a1, team_a2, team_b1, team_b2, wager_cents, status,
          tournament_id, tournament_match_id, tournament_stage, tournament_target, tournament_game_number)
          VALUES (@group, @id, @number, @a1, @a2, @b1, @b2, @wager, 'pending', @tournament, @match, @stage, @target, @seriesGame);`);
    } else if (before.status === 'pending' && game.status === 'completed') {
      await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('id', sql.NVarChar(80), game.id)
        .input('a', sql.BigInt, game.scoreA).input('b', sql.BigInt, game.scoreB)
        .query("UPDATE dbo.Games SET status = 'completed', score_a = @a, score_b = @b, completed_at = SYSUTCDATETIME() WHERE group_id = @group AND id = @id;");
    } else if (before.status === 'completed' && game.status === 'pending') {
      await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('id', sql.NVarChar(80), game.id)
        .query("UPDATE dbo.Games SET status = 'pending', score_a = NULL, score_b = NULL, completed_at = NULL WHERE group_id = @group AND id = @id;");
    }
  }
  for (const game of previous.games) {
    if (next.games.some((entry) => entry.id === game.id)) continue;
    await new sql.Request(tx).input('group', sql.UniqueIdentifier, next.id).input('id', sql.NVarChar(80), game.id)
      .query('DELETE dbo.Games WHERE group_id = @group AND id = @id;');
  }
  if (nextNumber !== next.nextGameNumber) throw new Error('Game allocation counter is inconsistent.');
  await new sql.Request(tx).input('id', sql.UniqueIdentifier, next.id).input('counter', sql.BigInt, next.nextGameNumber)
    .input('public', sql.Bit, isPublic).input('avatar', sql.VarChar(16), validateGroupAvatar(next.avatar))
    .query('UPDATE dbo.Groups SET next_game_number = @counter, is_public = @public, avatar = @avatar WHERE id = @id;');
}

function storedTournament(row: { id: string; state_json: string; created_at: Date }, group: Group): Tournament {
  try {
    const tournament = parseTournament(JSON.parse(row.state_json), group);
    if (tournament.id !== row.id.toLowerCase()) throw new Error('Tournament ID mismatch.');
    return { ...tournament, createdAt: row.created_at.toISOString(),
      completedAt: tournamentCompletedAt(group, tournament) };
  } catch (cause) { throw new Error('Stored tournament data is invalid.', { cause }); }
}

async function readTournament(tx: sql.Transaction, group: Group, id: string): Promise<Tournament> {
  const row = (await new sql.Request(tx).input('group', sql.UniqueIdentifier, group.id).input('id', sql.UniqueIdentifier, id)
    .query<{ id: string; state_json: string; created_at: Date }>('SELECT id, state_json, created_at FROM dbo.Tournaments WHERE group_id = @group AND id = @id;')).recordset[0];
  if (!row) throw new ApiError(404, 'tournament_not_found', 'This tournament was not found.');
  return storedTournament(row, group);
}

async function readTournaments(tx: sql.Transaction, group: Group): Promise<Tournament[]> {
  const rows = await new sql.Request(tx).input('group', sql.UniqueIdentifier, group.id)
    .query<{ id: string; state_json: string; created_at: Date }>('SELECT id, state_json, created_at FROM dbo.Tournaments WHERE group_id = @group ORDER BY created_at DESC, id;');
  return rows.recordset.map((row) => storedTournament(row, group));
}

async function readOwnershipReceipt(tx: sql.Transaction, actor: Player, requestId: string, fingerprint: string): Promise<GroupLifecycleReceipt | null> {
  const row = (await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
    .input('request', sql.UniqueIdentifier, requestId).query<{ group_id: string; fingerprint: string; action: string }>(`
      SELECT group_id, fingerprint, action FROM dbo.GroupLifecycleMutations WITH (UPDLOCK, HOLDLOCK)
      WHERE actor_id = @actor AND request_id = @request;`)).recordset[0];
  if (!row) return null;
  if (row.fingerprint !== fingerprint || (row.action !== 'transfer' && row.action !== 'delete')) {
    throw new ApiError(409, 'request_reused', 'This request ID belongs to another operation.');
  }
  return { groupId: row.group_id.toLowerCase(), action: row.action };
}

export function createSqlStore(pool: sql.ConnectionPool): GroupStore {
  return {
    async ownershipReceipt(actor, requestId, fingerprint) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE,
        (tx) => readOwnershipReceipt(tx, actor, requestId, fingerprint));
    },
    async changeOwnership(actor, id, revision, action, target, requestId, fingerprint) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        const old = await readOwnershipReceipt(tx, actor, requestId, fingerprint);
        if (old) {
          if (old.groupId !== id || old.action !== action.type) {
            throw new ApiError(409, 'request_reused', 'This request ID belongs to another operation.');
          }
          return old;
        }
        if (await replay(tx, actor, requestId, fingerprint)) throw new ApiError(409, 'request_reused', 'This request ID belongs to another operation.');
        const group = await load(tx, actor, id, true);
        if (!group.isOwner) throw new ApiError(403, 'owner_required', 'Only the current owner can transfer or delete this group.');
        if (group.revision !== revision) throw new ApiError(412, 'group_changed', 'The group changed. Refresh before confirming this action again.');
        if (action.type === 'transfer') {
          if (!target || target.id !== action.playerId || target.id === actor.id || target.isGuest || target.isDeleted ||
              !group.players.some((player) => player.id === target.id && !player.isGuest && !player.isDeleted)) {
            throw new ApiError(400, 'ineligible_owner', 'Choose a different active registered member as the new owner.');
          }
          await syncPlayer(tx, target);
          const names = await new sql.Request(tx).input('owner', sql.UniqueIdentifier, target.id)
            .query<{ name: string }>('SELECT name FROM dbo.Groups WHERE owner_id = @owner;');
          createGroup(names.recordset, group.name, group.currency, group.avatar);
          await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('owner', sql.UniqueIdentifier, target.id)
            .input('previousOwner', sql.UniqueIdentifier, actor.id)
            .query(`UPDATE dbo.GroupMembers SET is_admin = 0 WHERE group_id = @group AND player_id IN (@owner, @previousOwner);
              UPDATE dbo.Groups SET owner_id = @owner WHERE id = @group;`);
        } else {
          await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).query(`
            DECLARE @localPlayers TABLE (id uniqueidentifier PRIMARY KEY);
            INSERT @localPlayers SELECT p.id FROM dbo.Players p JOIN dbo.GroupMembers m ON p.id = m.player_id
              WHERE m.group_id = @group AND (p.is_guest = 1 OR p.is_deleted = 1);
            INSERT dbo.GroupLifecycleMutations(actor_id, request_id, fingerprint, group_id, action)
              SELECT actor_id, request_id, fingerprint, group_id, 'retired' FROM dbo.Mutations WHERE group_id = @group;
            DELETE dbo.Mutations WHERE group_id = @group;
            DELETE dbo.Games WHERE group_id = @group;
            DELETE dbo.Tournaments WHERE group_id = @group;
            DELETE dbo.GroupJoinRequests WHERE group_id = @group;
            DELETE dbo.GroupMembers WHERE group_id = @group;
            DELETE dbo.Groups WHERE id = @group;
            DELETE p FROM dbo.Players p JOIN @localPlayers l ON l.id = p.id
              WHERE NOT EXISTS (SELECT 1 FROM dbo.GroupMembers m WHERE m.player_id = p.id);`);
        }
        await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id).input('request', sql.UniqueIdentifier, requestId)
          .input('fingerprint', sql.Char(64), fingerprint).input('group', sql.UniqueIdentifier, id).input('action', sql.VarChar(8), action.type)
          .query('INSERT dbo.GroupLifecycleMutations(actor_id, request_id, fingerprint, group_id, action) VALUES (@actor, @request, @fingerprint, @group, @action);');
        return { groupId: id, action: action.type };
      });
    },
    async prepareAccountDeletion(actor, requestId) {
      return transaction(pool, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        if (actor.isGuest || actor.isDeleted) throw new ApiError(403, 'account_required', 'An active registered account is required.');
        const existing = (await new sql.Request(tx).input('hash', sql.VarBinary(32), accountHash(actor.id))
          .query<{ id: string; completed_at: Date | null; retrying: boolean }>(`
            SELECT id, completed_at, retrying FROM dbo.AccountDeletions WITH (UPDLOCK, HOLDLOCK) WHERE account_hash = @hash;`)).recordset[0];
        if (existing) return { id: existing.id.toLowerCase(), status: existing.completed_at ? 'completed' : 'pending', retrying: existing.retrying };
        const used = await new sql.Request(tx).input('id', sql.UniqueIdentifier, requestId)
          .query('SELECT id FROM dbo.AccountDeletions WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;');
        if (used.recordset.length) throw new ApiError(409, 'request_reused', 'This deletion request ID is already in use.');
        await syncPlayer(tx, actor);
        const owned = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .query('SELECT id FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE owner_id = @actor;');
        if (owned.recordset.length) throw new ApiError(409, 'owned_groups_remaining', 'Transfer ownership or delete every group you own before deleting your account.');
        const memberships = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .query<{ group_id: string }>('SELECT group_id FROM dbo.GroupMembers WHERE player_id = @actor ORDER BY group_id;');
        for (const membership of memberships.recordset) {
          const group = await load(tx, actor, membership.group_id.toLowerCase(), true);
          const result = anonymizeParticipant(group, await readTournaments(tx, group), actor.id, randomUUID());
          if (!result.anonymous) await saveChanges(tx, group, result.group, group.isPublic);
          else {
            await new sql.Request(tx).input('group', sql.UniqueIdentifier, group.id).input('old', sql.UniqueIdentifier, actor.id)
              .input('new', sql.UniqueIdentifier, result.anonymous.id).input('avatar', sql.VarChar(16), DEFAULT_AVATAR).query(`
                INSERT dbo.Players(id, display_name, avatar, is_deleted) VALUES (@new, N'Deleted player', @avatar, 1);
                INSERT dbo.GroupMembers(group_id, player_id, name_snapshot, position)
                  SELECT @group, @new, N'Deleted player', MAX(position) + 1 FROM dbo.GroupMembers WHERE group_id = @group;
                UPDATE dbo.Games SET
                  team_a1 = CASE WHEN team_a1 = @old THEN @new ELSE team_a1 END,
                  team_a2 = CASE WHEN team_a2 = @old THEN @new ELSE team_a2 END,
                  team_b1 = CASE WHEN team_b1 = @old THEN @new ELSE team_b1 END,
                  team_b2 = CASE WHEN team_b2 = @old THEN @new ELSE team_b2 END
                  WHERE group_id = @group;
                DECLARE @position int = (SELECT position FROM dbo.GroupMembers WHERE group_id = @group AND player_id = @old);
                DELETE dbo.GroupMembers WHERE group_id = @group AND player_id = @old;
                UPDATE dbo.GroupMembers SET position = @position WHERE group_id = @group AND player_id = @new;
                UPDATE dbo.Groups SET name = name WHERE id = @group;`);
            for (const tournament of result.tournaments) {
              const { createdAt, completedAt, ...state } = tournament;
              await new sql.Request(tx).input('group', sql.UniqueIdentifier, group.id).input('id', sql.UniqueIdentifier, tournament.id)
                .input('state', sql.NVarChar(sql.MAX), JSON.stringify(state))
                .query('UPDATE dbo.Tournaments SET state_json = @state WHERE group_id = @group AND id = @id;');
            }
          }
        }
        await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id).input('id', sql.UniqueIdentifier, requestId)
          .input('hash', sql.VarBinary(32), accountHash(actor.id)).query(`
            DELETE dbo.Mutations WHERE actor_id = @actor;
            DELETE dbo.GroupLifecycleMutations WHERE actor_id = @actor;
            DELETE dbo.GroupJoinRequests WHERE player_id = @actor;
            DELETE dbo.Players WHERE id = @actor;
            INSERT dbo.AccountDeletions(id, account_hash, account_id) VALUES (@id, @hash, @actor);`);
        return { id: requestId, status: 'pending', retrying: false };
      });
    },
    async deletionStatus(id): Promise<AccountDeletionStatus> {
      const row = (await pool.request().input('id', sql.UniqueIdentifier, id)
        .query<{ completed_at: Date | null; retrying: boolean }>('SELECT completed_at, retrying FROM dbo.AccountDeletions WHERE id = @id;')).recordset[0];
      if (!row) throw new ApiError(404, 'deletion_not_found', 'No accepted deletion request was found for this receipt.');
      return { id, status: row.completed_at ? 'completed' : 'pending', retrying: row.retrying };
    },
    async pendingDeletions() {
      const rows = await pool.request().query<{ id: string; account_id: string }>(`
        SELECT TOP (5) id, account_id FROM dbo.AccountDeletions WHERE completed_at IS NULL ORDER BY COALESCE(last_attempt_at, created_at), id;`);
      return rows.recordset.map((row) => ({ id: row.id.toLowerCase(), accountId: row.account_id.toLowerCase() }));
    },
    async finishDeletion(id, accountId) {
      const rows = await pool.request().input('id', sql.UniqueIdentifier, id).input('account', sql.UniqueIdentifier, accountId)
        .query<{ completed_at: Date | null }>(`
          UPDATE dbo.AccountDeletions SET account_id = NULL, completed_at = SYSUTCDATETIME(), retrying = 0
            WHERE id = @id AND account_id = @account;
          SELECT completed_at FROM dbo.AccountDeletions WHERE id = @id;`);
      if (!rows.recordset[0]?.completed_at) throw new Error('Account deletion completion was not recorded.');
    },
    async failDeletion(id) {
      await pool.request().input('id', sql.UniqueIdentifier, id)
        .query('UPDATE dbo.AccountDeletions SET retrying = 1, last_attempt_at = SYSUTCDATETIME() WHERE id = @id AND completed_at IS NULL;');
    },
    async syncPlayer(player) {
      return transaction(pool, sql.ISOLATION_LEVEL.SERIALIZABLE, (tx) => syncPlayer(tx, player));
    },
    async resolvePlayerCode(actor, value) {
      const code = validatePlayerCode(value);
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async tx => {
        const row = (await new sql.Request(tx).input('code', sql.VarChar(6), code)
          .query<{ player_id: string }>(`
            SELECT c.player_id FROM dbo.PlayerCodes c JOIN dbo.Players p ON p.id = c.player_id
            WHERE c.code = @code AND p.is_guest = 0 AND p.is_deleted = 0;`)).recordset[0];
        if (!row) throw new ApiError(404, 'player_not_found', 'No eligible player was found. The account must be verified and have a display name.');
        return row.player_id.toLowerCase();
      });
    },
    async list(actor) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async (tx) => {
        const result = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id).query<{ id: string }>(`
          SELECT g.id FROM dbo.Groups g WHERE g.owner_id = @actor
            OR EXISTS (SELECT 1 FROM dbo.GroupMembers m JOIN dbo.Players p ON p.id = m.player_id
              WHERE m.group_id = g.id AND m.player_id = @actor AND p.is_guest = 0)
          ORDER BY g.created_at, g.id;`);
        const groups: SavedGroup[] = [];
        for (const row of result.recordset) groups.push(await load(tx, actor, row.id));
        return groups;
      });
    },
    async summaries(actor) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async (tx) => {
        const result = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .query<Omit<GroupRow, 'counter'> & { player_count: string; completed_count: string; latest_completed_at: Date | null; is_admin: boolean }>(`
            SELECT g.id, g.owner_id, p.display_name AS owner_name, g.name, g.currency, g.avatar,
              g.revision, g.is_public,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.GroupMembers admin_member
                WHERE admin_member.group_id = g.id AND admin_member.player_id = @actor AND admin_member.is_admin = 1)
                THEN 1 ELSE 0 END AS bit) AS is_admin,
              CONVERT(varchar(32), (SELECT COUNT_BIG(*) FROM dbo.GroupMembers m WHERE m.group_id = g.id)) AS player_count,
              CONVERT(varchar(32), activity.completed_count) AS completed_count, activity.latest_completed_at
            FROM dbo.Groups g JOIN dbo.Players p ON p.id = g.owner_id
            OUTER APPLY (
              SELECT COUNT_BIG(*) AS completed_count, MAX(games.completed_at) AS latest_completed_at
              FROM dbo.Games games WHERE games.group_id = g.id AND games.status = 'completed'
            ) activity
            WHERE g.owner_id = @actor OR EXISTS (
              SELECT 1 FROM dbo.GroupMembers m JOIN dbo.Players member_player ON member_player.id = m.player_id
              WHERE m.group_id = g.id AND m.player_id = @actor AND member_player.is_guest = 0 AND member_player.is_deleted = 0)
            ORDER BY g.created_at, g.id;`);
        return result.recordset.map((row) => ({
          id: row.id.toLowerCase(), name: row.name, avatar: validateGroupAvatar(row.avatar), currency: validateCurrency(row.currency),
          ownerId: row.owner_id.toLowerCase(), ownerName: row.owner_name, revision: row.revision.toString('hex'),
          canEdit: true, canManage: row.owner_id.toLowerCase() === actor.id || row.is_admin,
          isOwner: row.owner_id.toLowerCase() === actor.id, isPublic: row.is_public,
          playerCount: integer(row.player_count), completedGameCount: integer(row.completed_count),
          latestCompletedAt: row.latest_completed_at?.toISOString() ?? null,
        }));
      });
    },
    async get(actor, id) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, (tx) => load(tx, actor, id));
    },
    async tournaments(actor, id) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async (tx) => {
        const group = await load(tx, actor, id);
        return { group, tournaments: await readTournaments(tx, group) };
      });
    },
    async changeTournament(actor, id, revision, action, requestId, fingerprint) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        const receipt = await replay(tx, actor, requestId, fingerprint);
        const previous = await load(tx, actor, id, true);
        if (action.type !== 'score' && !previous.canManage) throw new ApiError(403, 'admin_required', 'Only the owner or an admin can manage tournaments.');
        if (receipt) {
          if (!receipt.tournamentId || receipt.groupId !== id) throw new ApiError(409, 'request_reused', 'This request belongs to another operation.');
          return { group: previous, tournaments: await readTournaments(tx, previous), selectedId: receipt.tournamentId };
        }
        if (action.type !== 'create' && previous.revision !== revision) throw new ApiError(412, 'group_changed', 'The group or tournament changed. Refresh before retrying.');
        const result = action.type === 'create'
          ? action.style === 'rotating-partner-round-robin'
            ? createRotatingTournament(previous, randomUUID(), action.name, action.players, action.scoring)
            : createTournament(previous, randomUUID(), action.name, action.teams, action.scoring)
          : changeTournament(previous, await readTournament(tx, previous, action.id), action);
        const { createdAt, completedAt, ...state } = result.tournament;
        if (action.type === 'create') {
          await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('id', sql.UniqueIdentifier, result.tournament.id)
            .input('state', sql.NVarChar(sql.MAX), JSON.stringify(state))
            .query('INSERT dbo.Tournaments(group_id, id, state_json) VALUES (@group, @id, @state);');
        }
        await saveChanges(tx, previous, result.group, previous.isPublic);
        if (action.type !== 'create') {
          await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('id', sql.UniqueIdentifier, result.tournament.id)
            .input('state', sql.NVarChar(sql.MAX), JSON.stringify(state))
            .query('UPDATE dbo.Tournaments SET state_json = @state WHERE group_id = @group AND id = @id;');
        }
        await remember(tx, actor, id, requestId, fingerprint, result.tournament.id);
        const group = await load(tx, actor, id);
        return { group, tournaments: await readTournaments(tx, group), selectedId: result.tournament.id };
      });
    },
    async search(actor, query, cursor) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async (tx) => {
        const pattern = `%${query.replace(/[~%_\[]/g, '~$&')}%`;
        const result = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .input('pattern', sql.NVarChar(sql.MAX), pattern.toLowerCase()).input('cursor', sql.UniqueIdentifier, cursor)
          .query<{ id: string; name: string; avatar: string; owner_name: string; member_count: number; relationship: PublicGroup['relationship'] }>(`
            SELECT TOP (21) g.id, g.name, g.avatar, p.display_name AS owner_name,
              (SELECT COUNT(*) FROM dbo.GroupMembers m WHERE m.group_id = g.id) AS member_count,
              CASE WHEN g.owner_id = @actor OR EXISTS
                (SELECT 1 FROM dbo.GroupMembers m WHERE m.group_id = g.id AND m.player_id = @actor)
                THEN 'member' ELSE COALESCE(r.status, 'none') END AS relationship
            FROM dbo.Groups g JOIN dbo.Players p ON p.id = g.owner_id
            LEFT JOIN dbo.GroupJoinRequests r ON r.group_id = g.id AND r.player_id = @actor
            WHERE g.is_public = 1 AND LOWER(g.name) LIKE @pattern ESCAPE '~'
              AND (@cursor IS NULL OR g.id > @cursor)
            ORDER BY g.id;`);
        const groups = result.recordset.slice(0, 20).map((row) => ({
          id: row.id.toLowerCase(), name: row.name, avatar: validateGroupAvatar(row.avatar), ownerName: row.owner_name,
          memberCount: row.member_count, relationship: row.relationship,
        }));
        return { groups, nextCursor: result.recordset.length > 20 ? groups[19].id : null };
      });
    },
    async requestJoin(actor, id, requestId, fingerprint) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        const replayed = await replay(tx, actor, requestId, fingerprint);
        const row = (await new sql.Request(tx).input('id', sql.UniqueIdentifier, id)
          .query<{ owner_id: string; is_public: boolean }>('SELECT owner_id, is_public FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;')).recordset[0];
        if (!row || (!row.is_public && !replayed)) throw new ApiError(404, 'group_not_found', 'This public group is no longer available.');
        const member = await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('actor', sql.UniqueIdentifier, actor.id)
          .query('SELECT player_id FROM dbo.GroupMembers WHERE group_id = @group AND player_id = @actor;');
        if (row.owner_id.toLowerCase() === actor.id || member.recordset.length) {
          if (!replayed) await remember(tx, actor, id, requestId, fingerprint);
          return 'member';
        }
        if (replayed) {
          const existing = (await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('actor', sql.UniqueIdentifier, actor.id)
            .query<{ status: 'pending' | 'declined' }>('SELECT status FROM dbo.GroupJoinRequests WHERE group_id = @group AND player_id = @actor;')).recordset[0];
          if (!existing) throw new ApiError(409, 'request_changed', 'This request is no longer available. Refresh your search.');
          return existing.status;
        }
        await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('actor', sql.UniqueIdentifier, actor.id).query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.GroupJoinRequests WHERE group_id = @group AND player_id = @actor AND status = 'pending')
          BEGIN
            UPDATE dbo.GroupJoinRequests SET status = 'pending', requested_at = SYSUTCDATETIME()
              WHERE group_id = @group AND player_id = @actor;
            IF @@ROWCOUNT = 0 INSERT dbo.GroupJoinRequests(group_id, player_id, status) VALUES (@group, @actor, 'pending');
          END;`);
        await remember(tx, actor, id, requestId, fingerprint);
        return 'pending';
      });
    },
    async requests(actor, id) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SNAPSHOT, async (tx) => {
        const group = await load(tx, actor, id);
        if (!group.canManage) throw new ApiError(403, 'admin_required', 'Only the owner or an admin can review join requests.');
        const result = await new sql.Request(tx).input('group', sql.UniqueIdentifier, id)
          .query<{ player_id: string; display_name: string; code: string | null }>(`
            SELECT r.player_id, p.display_name, c.code FROM dbo.GroupJoinRequests r
            JOIN dbo.Players p ON p.id = r.player_id
            LEFT JOIN dbo.PlayerCodes c ON c.player_id = p.id AND p.is_guest = 0 AND p.is_deleted = 0
            WHERE r.group_id = @group AND r.status = 'pending' ORDER BY r.requested_at, r.player_id;`);
        return result.recordset.map((row) => ({ playerId: row.player_id.toLowerCase(), displayName: row.display_name,
          ...(row.code == null ? {} : { code: validatePlayerCode(row.code) }) }));
      });
    },
    async create(actor, name, requestId, fingerprint, currency = 'none', avatar = DEFAULT_GROUP_AVATAR) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        const existing = await replay(tx, actor, requestId, fingerprint);
        if (existing) return load(tx, actor, existing.groupId);
        // Serialize name checks per owner without imposing a new global name limit.
        await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .query('SELECT id FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE id = @actor;');
        const names = await new sql.Request(tx).input('actor', sql.UniqueIdentifier, actor.id)
          .query<{ name: string }>('SELECT name FROM dbo.Groups WHERE owner_id = @actor;');
        const group = { ...createOwnedGroup(names.recordset, name, actor, currency, avatar), id: randomUUID() };
        await new sql.Request(tx).input('id', sql.UniqueIdentifier, group.id).input('owner', sql.UniqueIdentifier, actor.id)
          .input('name', sql.NVarChar(sql.MAX), group.name)
          .input('currency', sql.VarChar(8), group.currency).input('avatar', sql.VarChar(16), group.avatar)
          .query('INSERT dbo.Groups(id, owner_id, name, currency, avatar) VALUES (@id, @owner, @name, @currency, @avatar);');
        await saveChanges(tx, { ...group, players: [] }, group, false);
        await remember(tx, actor, group.id, requestId, fingerprint);
        return load(tx, actor, group.id);
      });
    },
    async change(actor, id, revision, command, player, requestId, fingerprint) {
      return activeTransaction(pool, actor, sql.ISOLATION_LEVEL.SERIALIZABLE, async (tx) => {
        const existing = await replay(tx, actor, requestId, fingerprint);
        if (existing) return load(tx, actor, existing.groupId);
        const previous = await load(tx, actor, id, true);
        if (!mayChangeGroup(previous, command)) throw new ApiError(403, 'admin_required', 'Only the owner or an admin can perform this action.');
        if (command.type !== 'add-guest' && previous.revision !== revision) throw new ApiError(412, 'group_changed', 'This group changed on another device. Refresh it before retrying.');
        let next: Group = previous;
        if (command.type === 'review-request') {
          const pending = await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('player', sql.UniqueIdentifier, command.playerId)
            .query("SELECT player_id FROM dbo.GroupJoinRequests WHERE group_id = @group AND player_id = @player AND status = 'pending';");
          if (!pending.recordset.length) throw new ApiError(409, 'request_changed', 'This join request is no longer pending. Refresh the requests.');
          if (command.decision === 'approve') {
            if (!player || player.id !== command.playerId) throw new ApiError(404, 'player_not_found', 'No eligible player was found.');
            next = addPlayer(previous, player);
          } else {
            await new sql.Request(tx).input('group', sql.UniqueIdentifier, id).input('player', sql.UniqueIdentifier, command.playerId)
              .query("UPDATE dbo.GroupJoinRequests SET status = 'declined' WHERE group_id = @group AND player_id = @player;");
          }
        } else if (command.type === 'set-admin') {
          changeGroupAdmin(previous, actor.id, command.playerId, command.isAdmin);
          if (command.isAdmin) {
            if (!player || player.id !== command.playerId || player.isGuest || player.isDeleted) {
              throw new ApiError(400, 'ineligible_admin', 'Choose an active registered group player.');
            }
            await syncPlayer(tx, player);
          }
          await new sql.Request(tx).input('group', sql.UniqueIdentifier, id)
            .input('player', sql.UniqueIdentifier, command.playerId).input('admin', sql.Bit, command.isAdmin)
            .query('UPDATE dbo.GroupMembers SET is_admin = @admin WHERE group_id = @group AND player_id = @player;');
        } else if (command.type === 'set-avatar') {
          next = { ...previous, avatar: validateGroupAvatar(command.avatar) };
        } else if (command.type === 'remove-player') {
          next = removePlayer(previous, command.playerId, await readTournaments(tx, previous));
        } else if (command.type !== 'set-visibility') {
          next = applyCommand(previous, command, player);
        }
        await saveChanges(tx, previous, next, command.type === 'set-visibility' ? command.isPublic : previous.isPublic);
        await remember(tx, actor, id, requestId, fingerprint);
        return load(tx, actor, id);
      });
    },
  };
}
