import { createApp } from './app.js';
import { loadRuntimeConfig } from './config.js';
import { createPool } from './db/pool.js';
import { PgTransactionRepository } from './modules/transactions/pg-transaction.repository.js';
import { PgAccountRepository } from './modules/accounts/pg-account.repository.js';
import { PgBudgetRepository } from './modules/budgets/pg-budget.repository.js';
import { PgRecurringRepository } from './modules/recurring/pg-recurring.repository.js';
import { PgForecastRepository } from './modules/forecast/pg-forecast.repository.js';
import { PgAnalyticsRepository } from './modules/analytics/pg-analytics.repository.js';
import { GuestSessions } from './security/guest-sessions.js';
import { PgGoalRepository } from './modules/goals/pg-goal.repository.js';
import { createWorkspacePool } from './security/workspace-db.js';

const config = loadRuntimeConfig();
const pool = createPool(config.APP_DATABASE_URL);
const workspacePool = createWorkspacePool(pool);
const guestSessions = new GuestSessions(pool, workspacePool, config.SESSION_SECRET, config.CLIENT_ORIGIN, config.NODE_ENV === 'production');
const app = createApp({
  repository: new PgTransactionRepository(workspacePool),
  accounts: new PgAccountRepository(workspacePool),
  budgets: new PgBudgetRepository(workspacePool),
  recurring: new PgRecurringRepository(workspacePool),
  forecast: new PgForecastRepository(workspacePool),
  analytics: new PgAnalyticsRepository(workspacePool),
  goals: new PgGoalRepository(workspacePool),
  guestSessions,
  clientOrigin: config.CLIENT_ORIGIN,
  ...(config.TRUSTED_PROXY_CIDRS !== undefined
    ? { trustedProxies: config.TRUSTED_PROXY_CIDRS }
    : {}),
});

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`FinPilot API: http://${config.HOST}:${config.PORT}`);
});

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

async function shutdown() {
  server.close(async (error) => {
    if (error) { console.error(error); process.exitCode = 1; }
    try { await pool.end(); } catch (poolError) { console.error(poolError); process.exitCode = 1; }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
