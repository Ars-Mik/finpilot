import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { createWorkspacePool } from '../src/security/workspace-db.js';
import { GuestSessions } from '../src/security/guest-sessions.js';
import { PgTransactionRepository } from '../src/modules/transactions/pg-transaction.repository.js';
import { PgAccountRepository } from '../src/modules/accounts/pg-account.repository.js';
import { PgBudgetRepository } from '../src/modules/budgets/pg-budget.repository.js';
import { PgRecurringRepository } from '../src/modules/recurring/pg-recurring.repository.js';
import { PgForecastRepository } from '../src/modules/forecast/pg-forecast.repository.js';
import { PgAnalyticsRepository } from '../src/modules/analytics/pg-analytics.repository.js';
import { PgGoalRepository } from '../src/modules/goals/pg-goal.repository.js';

const origin = 'http://localhost:5173';
const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
const protectedTables = ['accounts', 'transactions', 'account_transfers', 'monthly_budgets', 'recurring_rules', 'savings_goals', 'goal_allocations', 'forecast_scenarios'] as const;

// Locally this suite is optional, because it creates real demo workspaces.
// In CI it MUST run against an isolated PostgreSQL service: a silent skip
// would be a false-positive security check.
if (process.env.CI === 'true' && !integrationUrl) {
  throw new Error('CI requires INTEGRATION_DATABASE_URL for the real PostgreSQL/RLS suite');
}

describe.skipIf(!integrationUrl)('guest isolation (real PostgreSQL)', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    pool = createPool(integrationUrl!);
    const scoped = createWorkspacePool(pool);
    const sessions = new GuestSessions(
      pool, scoped, randomBytes(32).toString('hex'), origin, false,
      () => new Date('2026-10-20T12:00:00Z'),
    );
    app = createApp({
      repository: new PgTransactionRepository(scoped),
      accounts: new PgAccountRepository(scoped),
      budgets: new PgBudgetRepository(scoped),
      recurring: new PgRecurringRepository(scoped),
      forecast: new PgForecastRepository(scoped),
      analytics: new PgAnalyticsRepository(scoped),
      goals: new PgGoalRepository(scoped),
      guestSessions: sessions,
      clientOrigin: origin,
    });
  });

  afterAll(async () => { await pool?.end(); });

  it('uses a nonprivileged role and enforces RLS on all eight financial tables', async () => {
    const role = await pool.query<{
      rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean;
    }>(
      'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user',
    );
    expect(role.rows[0]).toMatchObject({
      rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
    });

    const metadata = await pool.query<{
      relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [protectedTables],
    );
    expect(metadata.rows).toHaveLength(protectedTables.length);
    const runtimeUser = (await pool.query<{ name: string }>('SELECT current_user AS name')).rows[0]!.name;
    for (const table of protectedTables) {
      const definition = metadata.rows.find((row) => row.relname === table);
      expect(definition, `${table}: schema metadata missing`).toBeDefined();
      expect(definition!.relrowsecurity, `${table}: RLS disabled`).toBe(true);
      expect(definition!.relforcerowsecurity, `${table}: FORCE RLS disabled`).toBe(true);
      expect(definition!.owner, `${table}: runtime role must not own the table`).not.toBe(runtimeUser);

      const policy = await pool.query<{ policyname: string; qual: string; with_check: string }>(
        `SELECT policyname, qual, with_check FROM pg_policies
         WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'workspace_isolation'`,
        [table],
      );
      expect(policy.rows).toHaveLength(1);
      expect(policy.rows[0]!.qual).toContain('finpilot.workspace_id');
      expect(policy.rows[0]!.with_check).toContain('finpilot.workspace_id');

      // Without a transaction-local workspace, even SELECT is denied by RLS.
      const unscoped = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
      expect(unscoped.rows[0]!.total, `${table}: unscoped data leaked`).toBe(0);
    }
  });

  it('keeps two guests isolated across reads, writes, CSRF, concurrent queries and reset', async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    const [sessionA, sessionB] = await Promise.all([a.get('/api/session'), b.get('/api/session')]);
    expect(sessionA.status).toBe(201);
    expect(sessionB.status).toBe(201);
    expect(sessionA.body.data.mode).toBe('guest');
    expect(sessionB.body.data.mode).toBe('guest');
    expect(String(sessionA.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(sessionB.headers['set-cookie'])).toContain('SameSite=Lax');
    const csrfA = sessionA.body.data.csrfToken as string;
    const csrfB = sessionB.body.data.csrfToken as string;
    expect(csrfA).not.toBe(csrfB);
    expect((await a.get('/api/session')).status).toBe(200);

    expect((await request(app).get('/api/transactions')).status).toBe(401);
    expect((await a.get('/api/session').set('Origin', 'https://invalid.example')).status).toBe(403);
    expect((await a.post('/api/demo/reset').send({})).status).toBe(403);
    expect((await a.post('/api/demo/reset').set('X-FinPilot-CSRF', csrfB).send({})).status).toBe(403);
    expect((await a.post('/api/demo/reset').set('Origin', 'https://invalid.example')
      .set('X-FinPilot-CSRF', csrfA).send({})).status).toBe(403);

    const [accountsA, accountsB, budgetsA, budgetsB, rulesA, rulesB, transfersA, transfersB] = await Promise.all([
      a.get('/api/accounts'), b.get('/api/accounts'),
      a.get('/api/budgets?month=2026-10'), b.get('/api/budgets?month=2026-10'),
      a.get('/api/recurring?on=2026-10-20'), b.get('/api/recurring?on=2026-10-20'),
      a.get('/api/transfers'), b.get('/api/transfers'),
    ]);
    for (const response of [accountsA, accountsB, budgetsA, budgetsB, rulesA, rulesB, transfersA, transfersB]) {
      expect(response.status).toBe(200);
    }
    expect(accountsA.body.data).toHaveLength(2);
    expect(accountsB.body.data).toHaveLength(2);
    expect(accountsA.body.data[0].id).not.toBe(accountsB.body.data[0].id);
    expect(budgetsA.body.data.budgets).toHaveLength(3);
    expect(budgetsB.body.data.budgets).toHaveLength(3);
    expect(budgetsA.body.data.budgets[0].id).not.toBe(budgetsB.body.data.budgets[0].id);
    expect(rulesA.body.data).toHaveLength(2);
    expect(rulesB.body.data).toHaveLength(2);
    expect(rulesA.body.data[0].id).not.toBe(rulesB.body.data[0].id);
    expect(transfersA.body.data).toHaveLength(1);
    expect(transfersB.body.data).toHaveLength(1);
    expect(transfersA.body.data[0].id).not.toBe(transfersB.body.data[0].id);

    const foreignAccount = accountsB.body.data[0].id as string;
    const foreignBudget = budgetsB.body.data.budgets[0].id as string;
    const foreignRule = rulesB.body.data[0].id as string;
    expect((await a.post('/api/accounts').send({ name: 'Blocked', kind: 'cash', openingBalanceCents: 0 })).status).toBe(403);
    expect((await b.post('/api/transactions').set('X-FinPilot-CSRF', csrfA).send({
      title: 'Should fail', type: 'expense', category: 'Продукты', amountCents: 200,
      accountId: foreignAccount, date: '2026-10-20',
    })).status).toBe(403);

    const transaction = await b.post('/api/transactions').set('X-FinPilot-CSRF', csrfB).send({
      title: 'B PRIVATE', type: 'expense', category: 'Продукты', amountCents: 12345,
      accountId: foreignAccount, date: '2026-10-20',
    });
    expect(transaction.status).toBe(201);
    const transactionId = transaction.body.data.id as string;
    expect((await a.get(`/api/transactions/${transactionId}`)).status).toBe(404);
    expect((await a.delete(`/api/transactions/${transactionId}`)
      .set('X-FinPilot-CSRF', csrfA)).status).toBe(404);
    expect((await a.patch(`/api/budgets/${foreignBudget}`).set('X-FinPilot-CSRF', csrfA)
      .send({ limitCents: 500000 })).status).toBe(404);
    expect((await a.patch(`/api/recurring/${foreignRule}`).set('X-FinPilot-CSRF', csrfA)
      .send({ enabled: false })).status).toBe(404);

    const crossTransfer = await a.post('/api/transfers').set('X-FinPilot-CSRF', csrfA).send({
      fromAccountId: accountsA.body.data[0].id, toAccountId: foreignAccount,
      date: '2026-10-20', amountCents: 1000, note: 'cross tenant',
    });
    expect(crossTransfer.status).toBe(404);

    // Interleave tenant requests to exercise pool reuse and async context isolation.
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 === 0 ? a : b).get('/api/transactions').query({ search: 'B PRIVATE' }),
    ));
    for (const [index, response] of concurrent.entries()) {
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(index % 2 === 0 ? 0 : 1);
    }

    const resetA = await a.post('/api/demo/reset').set('X-FinPilot-CSRF', csrfA).send({});
    expect(resetA.status).toBe(200);
    expect((await b.get(`/api/transactions/${transactionId}`)).status).toBe(200);
    expect((await a.get(`/api/transactions/${transactionId}`)).status).toBe(404);
    expect((await b.get('/api/accounts')).body.data[0].id).toBe(accountsB.body.data[0].id);
    expect((await b.get('/api/recurring?on=2026-10-20')).body.data[0].enabled).toBe(true);
    expect((await b.get('/api/analytics?through=2026-10&months=6')).status).toBe(200);
    expect((await a.post('/api/forecast/simulate').set('X-FinPilot-CSRF', csrfA)
      .send({ months: 3, scenario: null })).status).toBe(200);
  }, 45000);

  it('shares a PostgreSQL-backed session creation limit across API instances', async () => {
    const secret = randomBytes(32).toString('hex');
    const scoped = createWorkspacePool(pool);
    const build = (trustedProxies?: string) => createApp({
      repository: new PgTransactionRepository(scoped),
      guestSessions: new GuestSessions(pool, scoped, secret, origin, false),
      clientOrigin: origin, ...(trustedProxies ? { trustedProxies } : {}),
    });
    const instanceOne = build('loopback');
    const instanceTwo = build('loopback');

    // Ten fresh sessions from one real client, alternately handled by two
    // processes, are admitted. The eleventh must be rejected by both.
    for (let i = 0; i < 10; i += 1) {
      const application = i % 2 === 0 ? instanceOne : instanceTwo;
      const response = await request(application).get('/api/session')
        .set('X-Forwarded-For', '203.0.113.10');
      expect(response.status, `attempt ${i + 1}`).toBe(201);
    }
    const denied = await request(instanceOne).get('/api/session')
      .set('X-Forwarded-For', '203.0.113.10');
    expect(denied.status).toBe(429);
    expect(denied.headers['retry-after']).toBe('3600');
    expect(denied.headers['set-cookie']).toBeUndefined();

    // A different client is not blocked by the first client's quota.
    expect((await request(instanceTwo).get('/api/session')
      .set('X-Forwarded-For', '203.0.113.11')).status).toBe(201);
  }, 60000);

});
