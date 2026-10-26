import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool } from '../src/db/pool.js';
import { createWorkspacePool } from '../src/security/workspace-db.js';
import { GuestSessions } from '../src/security/guest-sessions.js';
import { createApp } from '../src/app.js';
import { PgGoalRepository } from '../src/modules/goals/pg-goal.repository.js';
import { PgAccountRepository } from '../src/modules/accounts/pg-account.repository.js';
import { PgTransactionRepository } from '../src/modules/transactions/pg-transaction.repository.js';

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.CI === 'true' && !integrationUrl) {
  throw new Error('CI requires INTEGRATION_DATABASE_URL for savings goals tests');
}

describe.skipIf(!integrationUrl)('goals (real PostgreSQL)', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    pool = createPool(integrationUrl!);
    const scoped = createWorkspacePool(pool);
    const sessions = new GuestSessions(pool, scoped, randomBytes(32).toString('hex'),
      'http://localhost:5173', false, () => new Date('2026-10-20T12:00:00Z'));
    app = createApp({ repository: new PgTransactionRepository(scoped),
      accounts: new PgAccountRepository(scoped), goals: new PgGoalRepository(scoped),
      guestSessions: sessions, clientOrigin: 'http://localhost:5173' });
  });
  afterAll(async () => { await pool?.end(); });

  it('reserves without moving money and keeps workspaces isolated', async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    const [sessionA, sessionB] = await Promise.all([a.get('/api/session'), b.get('/api/session')]);
    expect(sessionA.status).toBe(201);
    expect(sessionB.status).toBe(201);
    const csrfA = sessionA.body.data.csrfToken as string;
    const csrfB = sessionB.body.data.csrfToken as string;
    const savingsA = (await a.get('/api/accounts')).body.data.find(
      (account: { kind: string }) => account.kind === 'savings',
    );
    expect(savingsA).toBeDefined();
    const balanceBefore = savingsA.balanceCents as number;
    const makeGoal = async (name: string) => a.post('/api/goals').set('X-FinPilot-CSRF', csrfA)
      .send({ name, accountId: savingsA.id, targetCents: 20000000, dueDate: '2027-08-01' });
    const created = await makeGoal('Новая цель');
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await b.post(`/api/goals/${id}/allocations`).set('X-FinPilot-CSRF', csrfB)
      .send({ action: 'reserve', amountCents: 100 })).status).toBe(404);
    expect((await b.post(`/api/goals/${id}/archive`).set('X-FinPilot-CSRF', csrfB).send({})).status).toBe(404);
    expect((await b.get(`/api/goals/${id}/allocations`)).status).toBe(404);
    expect((await a.post(`/api/goals/${id}/allocations`).set('X-FinPilot-CSRF', csrfB)
      .send({ action: 'reserve', amountCents: 100 })).status).toBe(403);
    const reserve = await a.post(`/api/goals/${id}/allocations`).set('X-FinPilot-CSRF', csrfA)
      .send({ action: 'reserve', amountCents: 6000000 });
    expect(reserve.status).toBe(201);
    expect(reserve.body.data.reservedCents).toBe(6000000);
    const available = reserve.body.data.accountBalanceCents - reserve.body.data.accountReservedCents;
    expect(available).toBeGreaterThanOrEqual(4000000);
    expect(available).toBeLessThan(8000000);
    expect((await a.get('/api/accounts')).body.data.find(
      (account: { id: string }) => account.id === savingsA.id,
    ).balanceCents).toBe(balanceBefore);
    expect((await a.post(`/api/goals/${id}/allocations`).set('X-FinPilot-CSRF', csrfA)
      .send({ action: 'release', amountCents: 7000000 })).status).toBe(409);
    const [g2, g3] = await Promise.all([makeGoal('Цель B'), makeGoal('Цель C')]);
    expect(g2.status).toBe(201);
    expect(g3.status).toBe(201);
    const two = await Promise.all([g2, g3].map((goal) => a.post(`/api/goals/${goal.body.data.id}/allocations`)
      .set('X-FinPilot-CSRF', csrfA).send({ action: 'reserve', amountCents: 4000000 })));
    expect(two.map((response) => response.status).sort()).toEqual([201, 409]);
    const afterConcurrent = (await a.get('/api/goals')).body.data as Array<{
      accountId: string; accountBalanceCents: number; accountReservedCents: number;
    }>;
    const accountState = afterConcurrent.find((goal) => goal.accountId === savingsA.id);
    expect(accountState).toBeDefined();
    expect(accountState!.accountReservedCents).toBeLessThanOrEqual(accountState!.accountBalanceCents);
    expect((await a.post(`/api/goals/${id}/archive`).set('X-FinPilot-CSRF', csrfA).send({})).status).toBe(204);
    expect((await a.get('/api/goals')).body.data.find((goal: {id: string}) => goal.id === id).reservedCents).toBe(0);
    expect((await a.post('/api/demo/reset').set('X-FinPilot-CSRF', csrfA).send({})).status).toBe(200);
    expect((await a.get('/api/goals')).body.data).toHaveLength(1);
    expect((await b.get('/api/goals')).status).toBe(200);
    expect((await a.post(`/api/goals/${randomUUID()}/allocations`).set('X-FinPilot-CSRF', csrfA)
      .send({ action: 'reserve', amountCents: 1 })).status).toBe(404);
  });

  it('does not over-reserve funds under repeated concurrent requests', async () => {
    const agent = request.agent(app);
    const session = await agent.get('/api/session');
    expect(session.status).toBe(201);
    const csrf = session.body.data.csrfToken as string;
    const savings = (await agent.get('/api/accounts')).body.data.find(
      (account: { kind: string }) => account.kind === 'savings',
    );
    expect(savings).toBeDefined();
    const create = async (name: string) => agent.post('/api/goals')
      .set('X-FinPilot-CSRF', csrf)
      .send({ name, accountId: savings.id, targetCents: 20000000, dueDate: '2027-08-01' });
    const [first, second] = await Promise.all([create('Test A'), create('Test B')]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const ids = [first.body.data.id as string, second.body.data.id as string];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const results = await Promise.all(ids.map((id) => agent.post(`/api/goals/${id}/allocations`)
        .set('X-FinPilot-CSRF', csrf).send({ action: 'reserve', amountCents: 6000000 })));
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const goals = (await agent.get('/api/goals')).body.data as Array<{
        id: string; accountId: string; accountBalanceCents: number; accountReservedCents: number;
      }>;
      const account = goals.find((goal) => goal.accountId === savings.id);
      expect(account).toBeDefined();
      expect(account!.accountReservedCents).toBeLessThanOrEqual(account!.accountBalanceCents);
      const winner = results.findIndex((result) => result.status === 201);
      const released = await agent.post(`/api/goals/${ids[winner]}/allocations`)
        .set('X-FinPilot-CSRF', csrf).send({ action: 'release', amountCents: 6000000 });
      expect(released.status).toBe(201);
    }
  });
});
