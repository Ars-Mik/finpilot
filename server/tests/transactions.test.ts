import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Transaction, TransactionInput, TransactionQuery } from '../src/modules/transactions/transaction.schema.js';
import type { TransactionPage, TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

class FakeRepository implements TransactionRepository {
  items: Transaction[] = [];

  async list(query: TransactionQuery): Promise<TransactionPage> {
    const filtered = this.items.filter((item) =>
      (!query.type || item.type === query.type)
      && (!query.month || item.date.startsWith(query.month))
      && (!query.search || `${item.title} ${item.category}`.toLowerCase().includes(query.search.toLowerCase())),
    );
    return { items: filtered.slice((query.page - 1) * query.limit, query.page * query.limit), total: filtered.length };
  }
  async findById(id: string) { return this.items.find((item) => item.id === id) ?? null; }
  async create(input: TransactionInput) {
    const item = { id: randomUUID(), ...input };
    this.items.push(item);
    return item;
  }
  async update(id: string, input: TransactionInput) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const updated = { id, ...input };
    this.items[index] = updated;
    return updated;
  }
  async remove(id: string) {
    const length = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    return this.items.length !== length;
  }
}

const validTransaction: TransactionInput = {
  title: 'Продукты', amountCents: 245_50, type: 'expense', category: 'Продукты', date: '2026-10-12',
};

function setup() {
  const repository = new FakeRepository();
  const app = createApp({ repository, clientOrigin: 'http://localhost:5173' });
  return { app, repository };
}

describe('transactions API', () => {
  it('returns health status', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('creates and reads a transaction', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/transactions').send(validTransaction);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject(validTransaction);
    expect(created.headers.location).toBe(`/api/transactions/${created.body.data.id}`);
    const found = await request(app).get(created.headers.location);
    expect(found.status).toBe(200);
    expect(found.body.data).toEqual(created.body.data);
  });

  it('rejects invalid amount, calendar date and category', async () => {
    const { app } = setup();
    for (const payload of [
      { ...validTransaction, amountCents: 0 },
      { ...validTransaction, date: '2026-02-30' },
      { ...validTransaction, category: 'Зарплата' },
    ]) {
      const response = await request(app).post('/api/transactions').send(payload);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('filters and paginates transactions', async () => {
    const { app, repository } = setup();
    await repository.create(validTransaction);
    await repository.create({ ...validTransaction, title: 'Кофе', category: 'Досуг' });
    await repository.create({ ...validTransaction, title: 'Зарплата', type: 'income', category: 'Зарплата' });
    const result = await request(app).get('/api/transactions?type=expense&limit=1&page=2');
    expect(result.status).toBe(200);
    expect(result.body.meta).toEqual({ total: 2, page: 2, limit: 1 });
    expect(result.body.data).toHaveLength(1);
  });

  it('partially updates a transaction and validates the merged result', async () => {
    const { app, repository } = setup();
    const existing = await repository.create(validTransaction);
    const updated = await request(app).patch(`/api/transactions/${existing.id}`).send({ amountCents: 555_00 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.amountCents).toBe(555_00);
    const invalid = await request(app).patch(`/api/transactions/${existing.id}`).send({ type: 'income' });
    expect(invalid.status).toBe(422);
  });

  it('deletes a transaction and then returns 404', async () => {
    const { app, repository } = setup();
    const existing = await repository.create(validTransaction);
    expect((await request(app).delete(`/api/transactions/${existing.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/transactions/${existing.id}`)).status).toBe(404);
  });

  it('rejects unknown fields and invalid identifiers', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/transactions').send({ ...validTransaction, ownerId: 'anyone' })).status).toBe(422);
    expect((await request(app).delete('/api/transactions/not-an-id')).status).toBe(422);
  });

  it('returns 404 for missing records', async () => {
    const { app } = setup();
    const missingId = randomUUID();
    expect((await request(app).get(`/api/transactions/${missingId}`)).status).toBe(404);
    expect((await request(app).patch(`/api/transactions/${missingId}`).send({ title: 'Test' })).status).toBe(404);
    expect((await request(app).delete(`/api/transactions/${missingId}`)).status).toBe(404);
  });

  it('rejects invalid pagination and unsupported query parameters', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/transactions?page=0')).status).toBe(422);
    expect((await request(app).get('/api/transactions?limit=999')).status).toBe(422);
    expect((await request(app).get('/api/transactions?userId=1')).status).toBe(422);
  });

  it('rejects malformed JSON requests', async () => {
    const { app } = setup();
    const response = await request(app)
      .post('/api/transactions')
      .set('Content-Type', 'application/json')
      .send('{broken json');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

});
