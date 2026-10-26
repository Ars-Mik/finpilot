import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { createWorkspacePool } from '../src/security/workspace-db.js';
import { GuestSessions } from '../src/security/guest-sessions.js';
import { PgTransactionRepository } from '../src/modules/transactions/pg-transaction.repository.js';
import { PgForecastRepository } from '../src/modules/forecast/pg-forecast.repository.js';
import { PgSavedScenarioRepository } from '../src/modules/forecast/pg-saved-scenario.repository.js';

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.CI === 'true' && !integrationUrl) {
  throw new Error('CI requires INTEGRATION_DATABASE_URL for saved scenarios tests');
}

const payload = {
  months: 3,
  scenario: { kind: 'plan', title: 'Больше дохода', changes: [
    { title: 'Подработка', type: 'income', frequency: 'monthly', amountCents: 100000, date: '2026-11-01' },
  ] },
};

describe.skipIf(!integrationUrl)('saved scenarios (real PostgreSQL)', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    pool = createPool(integrationUrl!);
    const scoped = createWorkspacePool(pool);
    const guestSessions = new GuestSessions(pool, scoped, randomBytes(32).toString('hex'),
      'http://localhost:5173', false, () => new Date('2026-10-20T12:00:00Z'));
    app = createApp({ repository: new PgTransactionRepository(scoped),
      forecast: new PgForecastRepository(scoped),
      savedScenarios: new PgSavedScenarioRepository(scoped), guestSessions,
      clientOrigin: 'http://localhost:5173', now: () => new Date('2026-10-20T12:00:00Z') });
  });
  afterAll(async () => { await pool?.end(); });

  it('enforces RLS on saved scenarios even without a workspace context', async () => {
    const rows = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c WHERE c.oid = 'public.forecast_scenarios'::regclass`,
    );
    expect(rows.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const user = (await pool.query<{ name: string }>('SELECT current_user AS name')).rows[0]!.name;
    expect(rows.rows[0]!.owner).not.toBe(user);
    expect((await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM forecast_scenarios')).rows[0]!.count).toBe(0);
  });

  it('isolates guests, validates CSRF, recalculates without ledger writes and resets', async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    const [sessionA, sessionB] = await Promise.all([a.get('/api/session'), b.get('/api/session')]);
    expect(sessionA.status).toBe(201);
    expect(sessionB.status).toBe(201);
    const tokenA: string = sessionA.body.data.csrfToken;
    const tokenB: string = sessionB.body.data.csrfToken;
    const created = await a.post('/api/forecast/scenarios').set('X-FinPilot-CSRF', tokenA).send(payload);
    expect(created.status).toBe(201);
    const id: string = created.body.data.id;
    expect((await a.get('/api/forecast/scenarios')).body.data).toHaveLength(1);
    expect((await b.get('/api/forecast/scenarios')).body.data).toHaveLength(0);
    expect((await b.get(`/api/forecast/scenarios/${id}`)).status).toBe(404);
    expect((await b.put(`/api/forecast/scenarios/${id}`).set('X-FinPilot-CSRF', tokenB).send(payload)).status).toBe(404);
    expect((await b.delete(`/api/forecast/scenarios/${id}`).set('X-FinPilot-CSRF', tokenB)).status).toBe(404);
    expect((await a.delete(`/api/forecast/scenarios/${id}`).set('X-FinPilot-CSRF', tokenB)).status).toBe(403);
    const saved = (await a.get(`/api/forecast/scenarios/${id}`)).body.data;
    const before = (await a.get('/api/transactions')).body.meta.total;
    const simulation = await a.post('/api/forecast/simulate').set('X-FinPilot-CSRF', tokenA)
      .send({ months: saved.months, scenario: saved.scenario });
    expect(simulation.status).toBe(200);
    expect(simulation.body.data.scenario.title).toBe(payload.scenario.title);
    expect((await a.get('/api/transactions')).body.meta.total).toBe(before);
    expect((await a.put(`/api/forecast/scenarios/${id}`).set('X-FinPilot-CSRF', tokenA)
      .send({ ...payload, scenario: { ...payload.scenario, title: 'Обновлённый' } })).status).toBe(200);
    expect((await a.post('/api/demo/reset').set('X-FinPilot-CSRF', tokenA).send({})).status).toBe(200);
    expect((await a.get('/api/forecast/scenarios')).body.data).toHaveLength(0);
    expect((await b.get('/api/forecast/scenarios')).body.data).toHaveLength(0);
  });

  it('enforces 10 saves under concurrent requests from one workspace', async () => {
    const agent = request.agent(app);
    const session = await agent.get('/api/session');
    expect(session.status).toBe(201);
    const token: string = session.body.data.csrfToken;
    const responses = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const group = await Promise.all(Array.from({ length: 4 }, () =>
        agent.post('/api/forecast/scenarios').set('X-FinPilot-CSRF', token).send(payload)));
      responses.push(...group);
    }
    expect(responses.filter((response) => response.status === 201)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
    expect((await agent.get('/api/forecast/scenarios')).body.data).toHaveLength(10);
    const removed = responses.find((response) => response.status === 201)!.body.data.id as string;
    expect((await agent.delete(`/api/forecast/scenarios/${removed}`).set('X-FinPilot-CSRF', token)).status).toBe(204);
    expect((await agent.post('/api/forecast/scenarios').set('X-FinPilot-CSRF', token).send(payload)).status).toBe(201);
    expect((await agent.get('/api/forecast/scenarios')).body.data).toHaveLength(10);
  });
});
