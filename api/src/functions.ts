import { app } from '@azure/functions';
import sql from 'mssql';
import { createApi } from './api.ts';
import { createIdentityService } from './identity.ts';
import { createSqlStore } from './sqlStore.ts';
import type { GroupStore, IdentityService } from './contracts.ts';
import { createAccountAdministrator, processAccountDeletions } from './accountDeletion.ts';

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server setting: ${name}`);
  return value;
}

const pool = new sql.ConnectionPool({
  server: setting('AZURE_SQL_SERVER'),
  database: setting('AZURE_SQL_DATABASE'),
  authentication: { type: 'azure-active-directory-default', options: { clientId: process.env.AZURE_CLIENT_ID } },
  options: { encrypt: true, trustServerCertificate: false, abortTransactionOnError: true },
  pool: { min: 0, max: 4, idleTimeoutMillis: 30000 },
  connectionTimeout: 60000,
  requestTimeout: 30000,
});
pool.on('error', () => console.error('The database connection pool reported an error.'));
const identity = createIdentityService(setting('SUPABASE_URL'), setting('SUPABASE_PUBLISHABLE_KEY'));
const store = createSqlStore(pool);
const administrator = process.env.SUPABASE_SECRET_KEY
  ? createAccountAdministrator(setting('SUPABASE_URL'), process.env.SUPABASE_SECRET_KEY) : null;
const connectedStore: GroupStore = {
  ...store,
  async prepareAccountDeletion(actor, requestId) {
    await pool.connect();
    return store.prepareAccountDeletion(actor, requestId);
  },
  async deletionStatus(id) {
    await pool.connect();
    return store.deletionStatus(id);
  },
  async syncPlayer(player) {
    await pool.connect();
    return store.syncPlayer(player);
  },
};

app.http('dinknpc', {
  route: '{*path}',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '');
    const operation = request.method !== 'GET' ? null : path === '/groups' ? (url.searchParams.get('view') === 'summary' ? 'summaries' : 'statistics')
      : /^\/groups\/[0-9a-f-]{36}$/i.test(path) ? 'group' : null;
    const started = performance.now();
    const durations: Record<string, number> = {};
    async function measure<T>(stage: string, work: () => Promise<T>): Promise<T> {
      const before = performance.now();
      try { return await work(); }
      finally { durations[stage] = Math.round(performance.now() - before); }
    }
    const measuredIdentity: IdentityService = {
      ...identity,
      authenticate: (header) => measure('authenticationMs', () => identity.authenticate(header)),
    };
    const measuredStore: GroupStore = {
      ...connectedStore,
      async syncPlayer(player) {
        await measure('sqlConnectMs', () => pool.connect());
        return measure('profileSyncMs', () => store.syncPlayer(player));
      },
      summaries: (actor) => measure('sqlReadMs', () => store.summaries(actor)),
      list: (actor) => measure('sqlReadMs', () => store.list(actor)),
      get: (actor, id) => measure('sqlReadMs', () => store.get(actor, id)),
    };
    const response = await createApi(measuredStore, measuredIdentity, (message) => context.error(message), administrator !== null)(request);
    const body = await response.text();
    if (operation && process.env.DINKNPC_PERFORMANCE_LOGS === 'true') {
      context.log(JSON.stringify({ event: 'group-load', operation, status: response.status, ...durations,
        durationMs: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(body, 'utf8') }));
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), body };
  },
});

app.timer('accountDeletions', {
  schedule: '0 * * * * *',
  handler: async (_, context) => {
    if (!administrator) {
      context.warn('Account deletion worker is disabled: configure the server-only SUPABASE_SECRET_KEY.');
      return;
    }
    await pool.connect();
    await processAccountDeletions(store, administrator, (message) => context.error(message));
  },
});
