import sql from 'mssql';

export function guestNameChanges(players) {
  const reserved = new Set(players.map((player) => player.name.trim().toLowerCase()));
  const seen = new Set();
  const changes = [];
  for (const player of players) {
    const name = player.name.trim();
    if (!name) throw new Error('A stored guest has an empty name.');
    const key = name.toLowerCase();
    if (seen.has(key)) {
      let suffix = 2;
      let replacement;
      do { replacement = `${name} (${suffix++})`; } while (reserved.has(replacement.toLowerCase()));
      reserved.add(replacement.toLowerCase());
      changes.push({ id: player.id, name: replacement });
    }
    seen.add(key);
  }
  return changes;
}

export async function normalizeGuestNames(tx, groupId) {
  await new sql.Request(tx).input('group', sql.UniqueIdentifier, groupId)
    .query('SELECT id FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE id = @group;');
  const guests = await new sql.Request(tx).input('group', sql.UniqueIdentifier, groupId).query(`
    SELECT p.id, m.name_snapshot AS name FROM dbo.GroupMembers m JOIN dbo.Players p ON p.id = m.player_id
      WHERE m.group_id = @group AND p.is_guest = 1 ORDER BY m.position;`);
  const changes = guestNameChanges(guests.recordset);
  for (const player of changes) {
    await new sql.Request(tx).input('group', sql.UniqueIdentifier, groupId).input('player', sql.UniqueIdentifier, player.id)
      .input('name', sql.NVarChar(sql.MAX), player.name).query(`
        UPDATE dbo.GroupMembers SET name_snapshot = @name WHERE group_id = @group AND player_id = @player;
        UPDATE dbo.Players SET display_name = @name WHERE id = @player AND is_guest = 1;`);
  }
  if (changes.length) {
    await new sql.Request(tx).input('group', sql.UniqueIdentifier, groupId)
      .query('UPDATE dbo.Groups SET name = name WHERE id = @group;');
  }
  return changes.length;
}
