import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ScenarioLimitError, type SavedScenario, type SavedScenarioInput, type SavedScenarioRepository } from '../src/modules/forecast/saved-scenario.repository.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

const unusedTransactions: TransactionRepository = {
  async list() { throw new Error('Unused'); }, async overview() { throw new Error('Unused'); },
  async findById() { throw new Error('Unused'); }, async create() { throw new Error('Unused'); },
  async update() { throw new Error('Unused'); }, async remove() { throw new Error('Unused'); },
};

const payload: SavedScenarioInput = {
  months: 3,
  scenario: { kind: 'plan', title: 'Новый план', changes: [
    { title: 'Подработка', type: 'income', frequency: 'monthly', amountCents: 30000, date: '2026-11-10' },
  ] },
};

class MemorySavedScenarios implements SavedScenarioRepository {
  rows: SavedScenario[] = [];
  async list() { return this.rows; }
  async find(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async create(input: SavedScenarioInput) {
    if (this.rows.length >= 10) throw new ScenarioLimitError('Maximum of 10 saved scenarios');
    const row: SavedScenario = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.rows.push(row);
    return row;
  }
  async update(id: string, input: SavedScenarioInput) {
    const row = await this.find(id);
    if (!row) return null;
    Object.assign(row, input);
    return row;
  }
  async remove(id: string) { const size = this.rows.length; this.rows = this.rows.filter((r) => r.id !== id); return this.rows.length !== size; }
}

function setup() {
  const savedScenarios = new MemorySavedScenarios();
  const app = createApp({ repository: unusedTransactions, savedScenarios, clientOrigin: 'http://localhost:5173', now: () => new Date('2026-10-20T12:00:00Z') });
  return { savedScenarios, app };
}

describe('saved forecast scenarios API', () => {
  it('creates, lists, edits and removes a scenario', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/forecast/scenarios').send(payload);
    expect(created.status).toBe(201);
    const id: string = created.body.data.id;
    expect(created.headers.location).toBe(`/api/forecast/scenarios/${id}`);
    expect((await request(app).get('/api/forecast/scenarios')).body.data).toHaveLength(1);
    expect((await request(app).get(`/api/forecast/scenarios/${id}`)).body.data.scenario).toEqual(payload.scenario);
    const updated = await request(app).put(`/api/forecast/scenarios/${id}`).send({ ...payload,
      scenario: { ...payload.scenario, title: 'Изменённый план' } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.scenario.title).toBe('Изменённый план');
    expect((await request(app).delete(`/api/forecast/scenarios/${id}`)).status).toBe(204);
    expect((await request(app).get(`/api/forecast/scenarios/${id}`)).status).toBe(404);
  });

  it('rejects invalid inputs, past dates and unknown identifiers', async () => {
    const { app, savedScenarios } = setup();
    const change = payload.scenario.changes[0]!;
    for (const body of [
      { ...payload, months: 4 },
      { ...payload, scenario: { ...payload.scenario, changes: [] } },
      { ...payload, scenario: { ...payload.scenario, changes: Array(6).fill(change) } },
      { ...payload, scenario: { ...payload.scenario, changes: [{ ...change, date: '2026-10-01' }] } },
      { ...payload, scenario: { ...payload.scenario, changes: [{ ...change, date: '2027-01-01' }] } },
      { ...payload, scenario: { ...payload.scenario, changes: [{ ...change, amountCents: -1 }] } },
      { ...payload, scenario: { ...payload.scenario, changes: [{ ...change, workspaceId: randomUUID() }] } },
      { ...payload, workspaceId: randomUUID() },
    ]) expect((await request(app).post('/api/forecast/scenarios').send(body)).status).toBe(422);
    expect(savedScenarios.rows).toHaveLength(0);
    expect((await request(app).put(`/api/forecast/scenarios/${randomUUID()}`).send(payload)).status).toBe(404);
    expect((await request(app).delete(`/api/forecast/scenarios/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).get('/api/forecast/scenarios/invalid')).status).toBe(422);
  });

  it('returns 409 at the per-workspace limit', async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i += 1) expect((await request(app).post('/api/forecast/scenarios').send(payload)).status).toBe(201);
    const extra = await request(app).post('/api/forecast/scenarios').send(payload);
    expect(extra.status).toBe(409);
    expect(extra.body.error.code).toBe('SCENARIO_LIMIT');
  });
});
