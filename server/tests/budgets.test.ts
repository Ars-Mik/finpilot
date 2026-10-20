import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DuplicateBudgetError, type BudgetRepository } from '../src/modules/budgets/budget.repository.js';
import type { BudgetInput, BudgetPatch, BudgetOverview } from '../src/modules/budgets/budget.schema.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

const unusedTransactions: TransactionRepository = {
  async list() { throw new Error('Not used'); }, async overview() { throw new Error('Not used'); },
  async findById() { throw new Error('Not used'); }, async create() { throw new Error('Not used'); },
  async update() { throw new Error('Not used'); }, async remove() { throw new Error('Not used'); },
};

class FakeBudgets implements BudgetRepository {
  limits = new Map<string, BudgetInput & { id: string }>();
  // Simulates expenses on different accounts; transfers are deliberately excluded.
  spent = new Map([['Продукты', 14_000_00], ['Досуг', 2_000_00]]);

  async overview(month: string): Promise<BudgetOverview> {
    const budgets = [...this.limits.values()].filter((limit) => limit.month === month).map((limit) => {
      const spentCents = this.spent.get(limit.category) ?? 0;
      return { ...limit, spentCents, remainingCents: limit.limitCents - spentCents };
    });
    const coveredSpentCents = budgets.reduce((sum, value) => sum + value.spentCents, 0);
    const totalSpentCents = [...this.spent.values()].reduce((sum, value) => sum + value, 0);
    return {
      month, budgets,
      totalLimitCents: budgets.reduce((sum, value) => sum + value.limitCents, 0),
      coveredSpentCents, totalSpentCents,
      unbudgetedSpentCents: totalSpentCents - coveredSpentCents,
      overLimitCount: budgets.filter((budget) => budget.remainingCents < 0).length,
    };
  }

  async create(input: BudgetInput) {
    if ([...this.limits.values()].some((value) => value.month === input.month && value.category === input.category)) {
      throw new DuplicateBudgetError();
    }
    const budget = { id: randomUUID(), ...input };
    this.limits.set(budget.id, budget);
    return budget;
  }

  async update(id: string, input: BudgetPatch) {
    const existing = this.limits.get(id);
    if (!existing) return false;
    this.limits.set(id, { ...existing, limitCents: input.limitCents });
    return true;
  }

  async remove(id: string) { return this.limits.delete(id); }
}

function setup() {
  const budgets = new FakeBudgets();
  return { budgets, app: createApp({ repository: unusedTransactions, budgets, clientOrigin: 'http://localhost:5173' }) };
}

const valid = { month: '2026-10', category: 'Продукты', limitCents: 12_000_00 };

describe('budgets API', () => {
  it('returns monthly totals and spending without a budget', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/budgets').send(valid);
    expect(created.status).toBe(201);
    const response = await request(app).get('/api/budgets?month=2026-10');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalLimitCents: 12_000_00, coveredSpentCents: 14_000_00,
      totalSpentCents: 16_000_00, unbudgetedSpentCents: 2_000_00,
      overLimitCount: 1,
    });
    expect(response.body.data.budgets[0]).toMatchObject({ category: 'Продукты', remainingCents: -2_000_00 });
  });

  it('rejects invalid query parameters and dates', async () => {
    const { app } = setup();
    for (const query of ['month=2026-00', 'month=2026-13', 'month=0000-10', 'month=2026-10&owner=1']) {
      expect((await request(app).get(`/api/budgets?${query}`)).status).toBe(422);
    }
    expect((await request(app).get('/api/budgets')).status).toBe(422);
  });

  it('validates category, limit, month and extra fields', async () => {
    const { app } = setup();
    for (const payload of [
      { ...valid, category: 'Зарплата' }, { ...valid, limitCents: 0 },
      { ...valid, limitCents: 1.5 }, { ...valid, limitCents: 1_000_000_000_001 },
      { ...valid, month: '2026-02-01' }, { ...valid, owner: 'x' },
    ]) {
      expect((await request(app).post('/api/budgets').send(payload)).status).toBe(422);
    }
  });

  it('prevents duplicate budgets for a month and category', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/budgets').send(valid)).status).toBe(201);
    const duplicate = await request(app).post('/api/budgets').send(valid);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    expect((await request(app).post('/api/budgets').send({ ...valid, month: '2026-11' })).status).toBe(201);
  });

  it('updates only the limit and recalculates remaining amount', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/budgets').send(valid);
    const id = created.body.data.id as string;
    expect((await request(app).patch(`/api/budgets/${id}`).send({ limitCents: 20_000_00 })).status).toBe(204);
    const result = await request(app).get('/api/budgets?month=2026-10');
    expect(result.body.data.budgets[0]).toMatchObject({ limitCents: 20_000_00, remainingCents: 6_000_00 });
    expect((await request(app).patch(`/api/budgets/${id}`).send({ category: 'Досуг' })).status).toBe(422);
    expect((await request(app).patch(`/api/budgets/${id}`).send({ limitCents: -5 })).status).toBe(422);
  });

  it('deletes a budget without deleting its historical transactions', async () => {
    const { app } = setup();
    const id = (await request(app).post('/api/budgets').send(valid)).body.data.id as string;
    expect((await request(app).delete(`/api/budgets/${id}`)).status).toBe(204);
    const result = await request(app).get('/api/budgets?month=2026-10');
    expect(result.body.data.budgets).toEqual([]);
    expect(result.body.data.unbudgetedSpentCents).toBe(16_000_00);
    expect((await request(app).delete(`/api/budgets/${id}`)).status).toBe(404);
  });

  it('rejects unknown IDs, invalid UUIDs and malformed changes', async () => {
    const { app } = setup();
    expect((await request(app).delete('/api/budgets/not-a-uuid')).status).toBe(422);
    expect((await request(app).patch(`/api/budgets/${randomUUID()}`).send({ limitCents: 100 })).status).toBe(404);
    expect((await request(app).delete(`/api/budgets/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).patch(`/api/budgets/${randomUUID()}`).send({})).status).toBe(422);
  });
});
