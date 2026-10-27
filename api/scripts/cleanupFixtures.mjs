import sql from 'mssql';
import { createHash } from 'node:crypto';

export async function cleanupFixtures(pool, groupIds, playerIds, retiredCodes = []) {
  if (!groupIds.length && !playerIds.length && !retiredCodes.length) return;
  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  // Reads can leave pooled sessions at SNAPSHOT; fixture deletion needs a fresh write transaction.
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    for (const id of groupIds) {
      await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id).query(`
        DECLARE @guests TABLE (id uniqueidentifier PRIMARY KEY);
        INSERT @guests SELECT p.id FROM dbo.Players p JOIN dbo.GroupMembers m ON m.player_id = p.id
          WHERE m.group_id = @id AND (p.is_guest = 1 OR p.is_deleted = 1);
        DELETE dbo.GroupLifecycleMutations WHERE group_id = @id;
        DELETE dbo.Mutations WHERE group_id = @id;
        DELETE dbo.Games WHERE group_id = @id;
        DELETE dbo.Tournaments WHERE group_id = @id;
        DELETE dbo.GroupJoinRequests WHERE group_id = @id;
        DELETE dbo.GroupMembers WHERE group_id = @id;
        DELETE dbo.Players WHERE id IN (SELECT id FROM @guests)
          AND NOT EXISTS (SELECT 1 FROM dbo.GroupMembers WHERE player_id = dbo.Players.id);
        DELETE dbo.Groups WHERE id = @id;`);
    }
    for (const id of playerIds) {
      await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id)
        .input('hash', sql.VarBinary(32), createHash('sha256').update(`dinknpc-deleted-account:${id.toLowerCase()}`).digest())
        .query(`DELETE dbo.AccountDeletions WHERE account_hash = @hash;
          DELETE dbo.GroupLifecycleMutations WHERE actor_id = @id;
          DELETE dbo.PlayerCodes WHERE player_id = @id;
          DELETE dbo.Players WHERE id = @id;`);
    }
    for (const code of retiredCodes) {
      if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) throw new Error('Invalid fixture player code.');
      await new sql.Request(transaction).input('code', sql.VarChar(6), code)
        .query('DELETE dbo.PlayerCodes WHERE code = @code AND player_id IS NULL;');
    }
    await transaction.commit();
  } catch (error) {
    if (!rolledBack) await transaction.rollback();
    throw error;
  }
}
