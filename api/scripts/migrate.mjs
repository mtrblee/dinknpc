import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { adminConnection } from './adminConnection.mjs';
import { configureSqlIdentity, readSqlClientId } from './sqlIdentity.mjs';
import { normalizeGuestNames } from './guestNames.mjs';

const clientId = readSqlClientId(process.env);
const pool = await adminConnection();
try {
  await pool.request().batch('ALTER DATABASE CURRENT SET ALLOW_SNAPSHOT_ISOLATION ON;');
  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin();
  try {
    for (const name of ['001_initial.sql', '002_group_discovery.sql', '003_tournaments.sql', '004_player_avatars.sql', '005_activity_timestamps.sql', '006_guest_players.sql', '007_group_options.sql', '008_account_lifecycle.sql', '009_group_admins.sql', '010_player_codes.sql', '011_tournament_scoring.sql']) {
      await new sql.Request(transaction).batch(await readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8'));
    }
    const groups = await new sql.Request(transaction).query(`
      SELECT DISTINCT m.group_id FROM dbo.GroupMembers m JOIN dbo.Players p ON p.id = m.player_id WHERE p.is_guest = 1;`);
    let renamed = 0;
    for (const group of groups.recordset) renamed += await normalizeGuestNames(transaction, group.group_id);
    await transaction.commit();
    console.log(`Guest names normalized: ${renamed} duplicate name(s) renamed without changing player IDs or results.`);
  } catch (error) {
    if (!rolledBack) await transaction.rollback();
    throw error;
  }
  await configureSqlIdentity(pool.request(), clientId);
  console.log('Schema installed; managed identity has scoped data permissions, not schema-administrator rights.');
} finally {
  await pool.close();
}
