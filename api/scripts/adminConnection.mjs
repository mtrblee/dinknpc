import { AzureCliCredential } from '@azure/identity';
import sql from 'mssql';

export async function adminConnection() {
  const { AZURE_SQL_SERVER: server, AZURE_SQL_DATABASE: database, AZURE_TENANT_ID: tenantId } = process.env;
  if (!server || !database || !tenantId) throw new Error('Set AZURE_SQL_SERVER, AZURE_SQL_DATABASE and AZURE_TENANT_ID.');
  const credential = new AzureCliCredential({ tenantId });
  const token = await credential.getToken('https://database.windows.net/.default');
  return new sql.ConnectionPool({
    server, database,
    authentication: { type: 'azure-active-directory-access-token', options: { token: token.token } },
    options: { encrypt: true, trustServerCertificate: false, abortTransactionOnError: true },
    connectionTimeout: 90000, requestTimeout: 90000, pool: { min: 0, max: 4 },
  }).connect();
}
