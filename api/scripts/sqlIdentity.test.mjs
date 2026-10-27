import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureSqlIdentity, readSqlClientId } from './sqlIdentity.mjs';

const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const objectId = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

test('SQL identity configuration selects the client ID, never the legacy object ID', () => {
  assert.equal(readSqlClientId({
    API_IDENTITY_CLIENT_ID: ` ${clientId.toUpperCase()} `,
    API_IDENTITY_OBJECT_ID: objectId,
  }), clientId);
  assert.throws(() => readSqlClientId({ API_IDENTITY_OBJECT_ID: objectId }), /API_IDENTITY_CLIENT_ID/);
  for (const value of [undefined, '', '------------------------------------', 'not-a-guid']) {
    assert.throws(() => readSqlClientId({ API_IDENTITY_CLIENT_ID: value }), /client ID/);
  }
});

test('SQL provisioning binds the client GUID and refuses to silently replace an existing mapping', async () => {
  const inputs = [];
  let statement;
  const request = {
    input(name, type, value) { inputs.push({ name, value }); return this; },
    async query(value) { statement = value; },
  };
  await configureSqlIdentity(request, clientId);
  assert.deepEqual(inputs, [{ name: 'clientId', value: clientId }]);
  assert.match(statement, /CONVERT\(binary\(16\), @clientId\)/);
  assert.match(statement, /THROW 50000/);
  assert.doesNotMatch(statement, /DROP USER|db_owner|db_datawriter|db_datareader/);
  assert.match(statement, /GRANT SELECT, INSERT, UPDATE, DELETE ON dbo\.Games/);
  assert.match(statement, /GRANT SELECT, INSERT ON dbo\.PlayerCodes/);
  assert.doesNotMatch(statement, /GRANT [^\n]*(UPDATE|DELETE)[^\n]*ON dbo\.PlayerCodes/);
  assert.match(statement, /GRANT SELECT, INSERT, DELETE ON dbo\.Mutations/);
  assert.match(statement, /GRANT SELECT, INSERT, DELETE ON dbo\.GroupLifecycleMutations/);
  assert.match(statement, /GRANT SELECT, INSERT, UPDATE ON dbo\.AccountDeletions/);
  assert.doesNotMatch(statement, /GRANT [^\n]*DELETE ON dbo\.AccountDeletions/);
});

test('invalid identifiers and SQL failures do not become successful provisioning', async () => {
  let touched = false;
  await assert.rejects(configureSqlIdentity({
    input() { touched = true; return this; },
    async query() {},
  }, 'invalid'), /API_IDENTITY_CLIENT_ID/);
  assert.equal(touched, false);
  const failure = new Error('synthetic SQL failure');
  await assert.rejects(configureSqlIdentity({
    input() { return this; },
    async query() { throw failure; },
  }, clientId), (error) => error === failure);
});
