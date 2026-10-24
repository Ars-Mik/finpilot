import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const origin = 'http://localhost:5173';
const integrationUrl = process.env.INTEGRATION_DATABASE_URL;

// With INTEGRATION_DATABASE_URL this is a REAL PostgreSQL/RLS integration test.
// It is deliberately skipped in fast, database-free unit test runs.
describe.skipIf(!integrationUrl)('guest isolation (PostgreSQL)', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    pool = createPool(integrationUrl!);
    const scoped = createWorkspacePool(pool);
    const sessions = new GuestSessions(pool, scoped, 'integration-test-only-secret-0123456789', origin, false, () => new Date('2026-10-20T12:00:00Z'));
    app = createApp({
      repository: new PgTransactionRepository(scoped), accounts: new PgAccountRepository(scoped),
      budgets: new PgBudgetRepository(scoped), recurring: new PgRecurringRepository(scoped),
      forecast: new PgForecastRepository(scoped), analytics: new PgAnalyticsRepository(scoped),
      guestSessions: sessions, clientOrigin: origin,
    });
  });
  afterAll(async () => { await pool?.end(); });

  it('creates isolated demo workspaces, protects mutations, and resets only the caller', async () => {
    // The connection must not be a superuser or a role with BYPASSRLS.
    const privileges = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(privileges.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    expect(Number((await pool.query('SELECT COUNT(*) AS total FROM transactions')).rows[0].total)).toBe(0);
    const a = request.agent(app);
    const b = request.agent(app);
    const [sessionA, sessionB] = await Promise.all([a.get('/api/session'), b.get('/api/session')]);
    expect(sessionA.status).toBe(201);
    expect(sessionB.status).toBe(201);
    expect(sessionA.body.data.mode).toBe('guest');
    const csrfA = sessionA.body.data.csrfToken as string;
    const csrfB = sessionB.body.data.csrfToken as string;
    const firstA = await a.get('/api/accounts');
    const firstB = await b.get('/api/accounts');
    expect(firstA.status).toBe(200);
    expect(firstA.body.data).toHaveLength(2);
    expect(firstB.status).toBe(200);
    expect(firstB.body.data).toHaveLength(2);
    expect(firstA.body.data[0].id).not.toBe(firstB.body.data[0].id);
    expect((await request(app).get('/api/transactions')).status).toBe(401);

    const foreign = firstB.body.data[0].id as string;
    expect((await a.post('/api/accounts').send({ name: 'Blocked', kind: 'cash', openingBalanceCents: 0 })).status).toBe(403);
    const transaction = await b.post('/api/transactions').set('X-FinPilot-CSRF', csrfB).send({
      title: 'B PRIVATE', type: 'expense', category: 'Продукты', amountCents: 12345,
      accountId: foreign, date: '2026-10-20',
    });
    expect(transaction.status).toBe(201);
    const transactionId = transaction.body.data.id as string;
    expect((await a.get(`/api/transactions/${transactionId}`)).status).toBe(404);
    expect((await a.delete(`/api/transactions/${transactionId}`).set('X-FinPilot-CSRF', csrfA)).status).toBe(404);

    const crossTransfer = await a.post('/api/transfers').set('X-FinPilot-CSRF', csrfA).send({
      fromAccountId: firstA.body.data[0].id, toAccountId: foreign,
      date: '2026-10-20', amountCents: 1000, note: 'cross tenant',
    });
    expect(crossTransfer.status).toBe(404);

    const resetA = await a.post('/api/demo/reset').set('X-FinPilot-CSRF', csrfA).send({});
    expect(resetA.status).toBe(200);
    expect((await b.get(`/api/transactions/${transactionId}`)).status).toBe(200);
    expect((await a.get(`/api/transactions/${transactionId}`)).status).toBe(404);
    expect((await b.get('/api/analytics?through=2026-10&months=6')).status).toBe(200);
    expect((await a.post('/api/forecast/simulate').set('X-FinPilot-CSRF', csrfA).send({ months: 3, scenario: null })).status).toBe(200);
  }, 30000);
});
