import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, createGroup, recordResult, startGame } from './groups.ts';
import { getIndividualStandings } from './individualStats.ts';

const players = ['Alex', 'Blair', 'Casey', 'Drew'].map((name, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`, name,
}));
function withResult(group, first, second) {
  for (const player of players) group = addPlayer(group, player);
  group = startGame(group, players.slice(0, 2).map((p) => p.id), players.slice(2).map((p) => p.id), '5');
  return recordResult(group, group.games[0].id, first, second);
}

test('individual statistics keep separate group ranks and shared ties', () => {
  const first = withResult(createGroup([], 'First', 'money'), '11', '7');
  const second = withResult(createGroup([first], 'Second', 'money'), '7', '11');
  const managed = createGroup([first, second], 'Managed but not playing', 'money');
  const rows = getIndividualStandings([first, second, managed], players[0].id);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.standing.rank, row.standing.wins, row.standing.netUnits]),
    [[1, 1, 500], [3, 0, -500]]);
  assert.equal(rows[2].standing, null);
});

test('unplayed members remain unranked and identity is never matched by display name', () => {
  let group = addPlayer(createGroup([], 'New', 'money'), players[0]);
  assert.equal(getIndividualStandings([group], players[0].id)[0].standing.rank, null);
  group = addPlayer(group, { ...players[1], name: 'Alex' });
  assert.equal(getIndividualStandings([group], players[1].id)[0].standing.player.id, players[1].id);
  assert.equal(getIndividualStandings([group], players[2].id)[0].standing, null);
  assert.deepEqual(getIndividualStandings([], players[0].id), []);
});

test('individual statistics never aggregate Money and Boba units across groups', () => {
  const money = withResult(createGroup([], 'Money', 'money'), '11', '7');
  const boba = withResult(createGroup([money], 'Boba', 'boba'), '7', '11');
  const rows = getIndividualStandings([money, boba], players[0].id);
  assert.deepEqual(rows.map((row) => row.standing.netUnits), [500, -5]);
});
