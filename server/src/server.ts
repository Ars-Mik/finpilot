import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { PgTransactionRepository } from './modules/transactions/pg-transaction.repository.js';
import { PgAccountRepository } from './modules/accounts/pg-account.repository.js';
import { PgBudgetRepository } from './modules/budgets/pg-budget.repository.js';
import { PgRecurringRepository } from './modules/recurring/pg-recurring.repository.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = createApp({ repository: new PgTransactionRepository(pool), accounts: new PgAccountRepository(pool), budgets: new PgBudgetRepository(pool), recurring: new PgRecurringRepository(pool), clientOrigin: config.CLIENT_ORIGIN });

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`FinPilot API: http://${config.HOST}:${config.PORT}`);
});

async function shutdown() {
  server.close(async (error) => {
    if (error) { console.error(error); process.exitCode = 1; }
    try { await pool.end(); } catch (poolError) { console.error(poolError); process.exitCode = 1; }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
