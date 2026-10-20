import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';
import { occurrencesBetween, nextOccurrences } from '../src/modules/recurring/schedule.js';
import type { ApplyResult, RecurringInput, RecurringRule, RecurringWithPreview } from '../src/modules/recurring/recurring.schema.js';
import type { RecurringRepository } from '../src/modules/recurring/recurring.repository.js';

const unusedTransactions: TransactionRepository = {
  async list() { throw new Error('Not used'); }, async overview() { throw new Error('Not used'); },
  async findById() { throw new Error('Not used'); }, async create() { throw new Error('Not used'); },
  async update() { throw new Error('Not used'); }, async remove() { throw new Error('Not used'); },
};

const accountId = randomUUID();
const valid: RecurringInput = {
  title: 'Аренда', type: 'expense', category: 'Жильё', amountCents: 30_000_00,
  accountId, frequency: 'monthly', startDate: '2026-01-31', endDate: null,
};

class FakeRecurring implements RecurringRepository {
  rules = new Map<string, RecurringRule>();
  posted = new Set<string>();

  async list(on: string): Promise<RecurringWithPreview[]> {
    return [...this.rules.values()].map((rule) => ({
      ...rule, upcoming: rule.enabled ? nextOccurrences(rule, on) : [],
    }));
  }

  async create(input: RecurringInput) {
    const id = randomUUID();
    this.rules.set(id, { ...input, id, enabled: true });
    return { id };
  }

  async setEnabled(id: string, enabled: boolean) {
    const rule = this.rules.get(id);
    if (!rule) return false;
    this.rules.set(id, { ...rule, enabled });
    return true;
  }

  async applyDue(today: string): Promise<ApplyResult> {
    let created = 0;
    let alreadyRecorded = 0;
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      for (const date of occurrencesBetween(rule, '2025-10-20', today)) {
        const key = `${rule.id}:${date}`;
        if (this.posted.has(key)) alreadyRecorded += 1;
        else { this.posted.add(key); created += 1; }
      }
    }
    return { created, alreadyRecorded };
  }
}

function setup() {
  const recurring = new FakeRecurring();
  return {
    recurring,
    app: createApp({ repository: unusedTransactions, recurring,
      clientOrigin: 'http://localhost:5173', now: () => new Date('2026-10-20T12:00:00Z') }),
  };
}

describe('recurring schedules', () => {
  it('uses the last day for monthly rules starting on the 31st', () => {
    expect(occurrencesBetween(valid, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });

  it('handles leap years without shifting the anchor day', () => {
    expect(occurrencesBetween({ ...valid, startDate: '2028-01-31' }, '2028-02-01', '2028-04-30'))
      .toEqual(['2028-02-29', '2028-03-31', '2028-04-30']);
  });

  it('handles weekly intervals and end date inclusively', () => {
    const rule = { ...valid, frequency: 'weekly' as const, startDate: '2026-10-01', endDate: '2026-10-16' };
    expect(occurrencesBetween(rule, '2026-10-06', '2026-10-31')).toEqual(['2026-10-08', '2026-10-15']);
  });

  it('returns only upcoming occurrences and never dates before the start', () => {
    expect(nextOccurrences(valid, '2026-02-01')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrencesBetween(valid, '2025-01-01', '2025-12-31')).toEqual([]);
  });

  it('validates categories, dates, amount, end date and unknown properties', async () => {
    const { app } = setup();
    for (const payload of [
      { ...valid, category: 'Зарплата' }, { ...valid, amountCents: 0 },
      { ...valid, amountCents: 1.5 }, { ...valid, startDate: '2026-02-30' },
      { ...valid, endDate: '2025-12-31' }, { ...valid, frequency: 'daily' },
      { ...valid, extra: 'not allowed' },
    ]) {
      expect((await request(app).post('/api/recurring').send(payload)).status).toBe(422);
    }
  });

  it('creates rules and previews the next three payments', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/recurring').send(valid)).status).toBe(201);
    const response = await request(app).get('/api/recurring?on=2026-10-20');
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ title: 'Аренда', enabled: true,
      upcoming: ['2026-10-31', '2026-11-30', '2026-12-31'] });
  });

  it('posts due payments only once and never posts future payments', async () => {
    const { app } = setup();
    await request(app).post('/api/recurring').send({ ...valid, startDate: '2026-09-20' });
    const first = await request(app).post('/api/recurring/apply').send({});
    expect(first.body.data).toEqual({ created: 2, alreadyRecorded: 0 });
    const repeated = await request(app).post('/api/recurring/apply').send({});
    expect(repeated.body.data).toEqual({ created: 0, alreadyRecorded: 2 });
  });

  it('pauses and resumes a recurring rule', async () => {
    const { app } = setup();
    const id = (await request(app).post('/api/recurring').send(valid)).body.data.id as string;
    expect((await request(app).patch(`/api/recurring/${id}`).send({ enabled: false })).status).toBe(204);
    expect((await request(app).get('/api/recurring?on=2026-10-20')).body.data[0].upcoming).toEqual([]);
    expect((await request(app).post('/api/recurring/apply').send({})).body.data.created).toBe(0);
    expect((await request(app).patch(`/api/recurring/${id}`).send({ enabled: true })).status).toBe(204);
    expect((await request(app).get('/api/recurring?on=2026-10-20')).body.data[0].upcoming.length).toBe(3);
  });

  it('rejects unsupported query, updates and invalid ids', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/recurring?on=2026-10-20&owner=x')).status).toBe(422);
    expect((await request(app).get('/api/recurring?on=2026-02-30')).status).toBe(422);
    expect((await request(app).patch('/api/recurring/nope').send({ enabled: false })).status).toBe(422);
    expect((await request(app).patch(`/api/recurring/${randomUUID()}`).send({ enabled: false })).status).toBe(404);
    expect((await request(app).patch(`/api/recurring/${randomUUID()}`).send({ title: 'new' })).status).toBe(422);
    expect((await request(app).post('/api/recurring/apply').send({ throughDate: '2030-01-01' })).status).toBe(422);
  });
});
