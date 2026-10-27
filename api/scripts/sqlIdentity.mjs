import sql from 'mssql';

function validateClientId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new Error('Set API_IDENTITY_CLIENT_ID to the managed identity application/client ID, not its object/principal ID.');
  }
  return value.trim().toLowerCase();
}

export function readSqlClientId(environment) {
  return validateClientId(environment.API_IDENTITY_CLIENT_ID);
}

export async function configureSqlIdentity(request, value) {
  const clientId = validateClientId(value);
  // Application SQL SIDs use client IDs; Azure RBAC assignments still use object IDs.
  await request.input('clientId', sql.UniqueIdentifier, clientId).query(`
    IF DATABASE_PRINCIPAL_ID('dinknpc_api') IS NULL
    BEGIN
      DECLARE @sid varchar(34) = CONVERT(varchar(34), CONVERT(binary(16), @clientId), 1);
      EXEC('CREATE USER [dinknpc_api] WITH SID = ' + @sid + ', TYPE = E;');
    END;
    IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dinknpc_api' AND sid <> CONVERT(binary(16), @clientId))
      THROW 50000, 'The API SQL user does not match the managed identity client ID. Review and repair its mapping before migrating.', 1;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Players TO dinknpc_api;
    GRANT SELECT, INSERT ON dbo.PlayerCodes TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Groups TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.GroupMembers TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Games TO dinknpc_api;
    GRANT SELECT, INSERT, DELETE ON dbo.Mutations TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.GroupJoinRequests TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Tournaments TO dinknpc_api;
    GRANT SELECT, INSERT, DELETE ON dbo.GroupLifecycleMutations TO dinknpc_api;
    GRANT SELECT, INSERT, UPDATE ON dbo.AccountDeletions TO dinknpc_api;
  `);
}
