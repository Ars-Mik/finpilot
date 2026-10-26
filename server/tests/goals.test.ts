import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { GoalConflictError, GoalMissingError, type GoalRepository } from '../src/modules/goals/goal.repository.js';
import type { Goal, GoalCreate, GoalPatch, AllocationInput, GoalAllocation } from '../src/modules/goals/goal.schema.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

const unusedTransactions: TransactionRepository = {
  async list() { throw new Error('Not used'); }, async overview() { throw new Error('Not used'); },
  async findById() { throw new Error('Not used'); }, async create() { throw new Error('Not used'); },
  async update() { throw new Error('Not used'); }, async remove() { throw new Error('Not used'); },
};

class MemoryGoals implements GoalRepository {
  items: Goal[] = [];
  entries: GoalAllocation[] = [];
  async list() { return this.items; }
  async create(input: GoalCreate) {
    const goal: Goal = { ...input, id: randomUUID(), status: 'active', reservedCents: 0,
      remainingCents: input.targetCents, accountBalanceCents: 10000000, accountReservedCents: 0 };
    this.items.push(goal); return goal;
  }
  async update(id: string, patch: GoalPatch) {
    const goal = this.items.find((item) => item.id === id && item.status === 'active');
    if (!goal) return null;
    if (patch.targetCents !== undefined && patch.targetCents < goal.reservedCents) throw new GoalConflictError();
    Object.assign(goal, patch);
    goal.remainingCents = goal.targetCents - goal.reservedCents;
    return goal;
  }
  async allocate(id: string, input: AllocationInput) {
    const goal = this.items.find((item) => item.id === id);
    if (!goal) throw new GoalMissingError();
    if (goal.status === 'archived') throw new GoalConflictError();
    const delta = input.action === 'reserve' ? input.amountCents : -input.amountCents;
    if (goal.reservedCents + delta < 0 || goal.reservedCents + delta > goal.targetCents) throw new GoalConflictError();
    goal.reservedCents += delta;
    goal.accountReservedCents += delta;
    goal.remainingCents = goal.targetCents - goal.reservedCents;
    this.entries.push({ id: randomUUID(), goalId: id, deltaCents: delta, createdAt: new Date().toISOString() });
    return goal;
  }
  async archive(id: string) { const goal = this.items.find((item) => item.id === id); if (!goal) return false; goal.status = 'archived'; goal.accountReservedCents -= goal.reservedCents; goal.reservedCents = 0; return true; }
  async history(id: string) { return this.items.some((item) => item.id === id) ? this.entries.filter((entry) => entry.goalId === id) : null; }
}

const payload = { name: 'Отпуск', accountId: randomUUID(), targetCents: 100000, dueDate: '2027-08-10' };

function setup() {
  const goals = new MemoryGoals();
  return { goals, app: createApp({ repository: unusedTransactions, goals, clientOrigin: 'http://localhost:5173' }) };
}

describe('savings goals API', () => {
  it('validates name, amount, date and account identifier', async () => {
    const { app } = setup();
    for (const body of [
      { ...payload, name: '' }, { ...payload, targetCents: 0 },
      { ...payload, dueDate: '2027-02-30' }, { ...payload, accountId: 'invalid' },
      { ...payload, workspaceId: randomUUID() },
    ]) expect((await request(app).post('/api/goals').send(body)).status).toBe(422);
    expect((await request(app).post('/api/goals').send(payload)).status).toBe(201);
  });

  it('creates a goal, tracks allocations and archives it', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/goals').send(payload);
    const id = created.body.data.id as string;
    expect((await request(app).get('/api/goals')).body.data).toHaveLength(1);
    expect((await request(app).post(`/api/goals/${id}/allocations`)
      .send({ action: 'reserve', amountCents: 10000 })).body.data.reservedCents).toBe(10000);
    expect((await request(app).post(`/api/goals/${id}/allocations`)
      .send({ action: 'release', amountCents: 5000 })).body.data.reservedCents).toBe(5000);
    expect((await request(app).get(`/api/goals/${id}/allocations`)).body.data).toHaveLength(2);
    expect((await request(app).patch(`/api/goals/${id}`).send({ targetCents: 4999 })).status).toBe(409);
    expect((await request(app).post(`/api/goals/${id}/archive`).send({})).status).toBe(204);
    expect((await request(app).post(`/api/goals/${id}/allocations`)
      .send({ action: 'reserve', amountCents: 100 })).status).toBe(409);
  });

  it('does not leak nonexistent goals or accept malformed allocations', async () => {
    const { app } = setup();
    const id = randomUUID();
    expect((await request(app).patch(`/api/goals/${id}`).send({ name: 'X' })).status).toBe(404);
    expect((await request(app).post(`/api/goals/${id}/allocations`).send({ action: 'reserve', amountCents: 1 })).status).toBe(404);
    expect((await request(app).get(`/api/goals/${id}/allocations`)).status).toBe(404);
    expect((await request(app).post(`/api/goals/${id}/archive`).send({})).status).toBe(404);
    expect((await request(app).post(`/api/goals/${id}/allocations`).send({ action: 'reserve', amountCents: -1 })).status).toBe(422);
    expect((await request(app).post('/api/goals/bad/allocations').send({ action: 'reserve', amountCents: 5 })).status).toBe(422);
  });
});
