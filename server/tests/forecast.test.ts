import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';
import { buildForecast, forecastEndDate } from '../src/modules/forecast/forecast.service.js';
import type { ForecastRepository } from '../src/modules/forecast/forecast.repository.js';
import type { ForecastSnapshot } from '../src/modules/forecast/forecast.schema.js';

const transactions: TransactionRepository = {
  async list() { throw new Error('Not used'); }, async overview() { throw new Error('Not used'); },
  async findById() { throw new Error('Not used'); }, async create() { throw new Error('Not used'); },
  async update() { throw new Error('Not used'); }, async remove() { throw new Error('Not used'); },
};

const base: ForecastSnapshot = {
  openingBalanceCents: 10_000_00,
  bookedBalanceCents: 40_000_00,
  futureTransactions: [],
  recurringRules: [],
};
const input = { months: 3 as const, scenario: null };
const today = '2026-10-20';

describe('cash flow forecasts', () => {
  it('uses calendar month end, including leap-year February', () => {
    expect(forecastEndDate('2026-10-20', 3)).toBe('2026-12-31');
    expect(forecastEndDate('2028-01-02', 3)).toBe('2028-03-31');
    expect(forecastEndDate('2028-02-01', 3)).toBe('2028-04-30');
  });

  it('keeps the opening and booked balance when there are no future events', () => {
    const result = buildForecast(base, input, today);
    expect(result.currentBalanceCents).toBe(5_000_000);
    expect(result.months.map((month) => month.baselineCents)).toEqual([5_000_000, 5_000_000, 5_000_000]);
    expect(result.baseline.firstNegativeDate).toBeNull();
  });

  it('projects monthly and weekly recurring payments and preserves the original anchor', () => {
    const result = buildForecast({ ...base, recurringRules: [
      { id: 'salary', type: 'income', amountCents: 100_000, frequency: 'monthly', startDate: '2026-01-31', endDate: null },
      { id: 'bill', type: 'expense', amountCents: 5_000, frequency: 'weekly', startDate: '2026-10-21', endDate: '2026-11-06' },
    ] }, input, today);
    expect(result.months.map((month) => month.baselineCents)).toEqual([
      5_000_000 + 100_000 - 10_000,
      5_000_000 + 200_000 - 15_000,
      5_000_000 + 300_000 - 15_000,
    ]);
    expect(result.plannedEvents).toBe(6);
  });

  it('includes future manual operations, without counting their recurring posting twice', () => {
    const snapshot: ForecastSnapshot = { ...base,
      futureTransactions: [
        { date: '2026-10-31', type: 'expense', amountCents: 12_000, recurringRuleId: 'rent', recurringOccurrenceDate: '2026-10-31' },
        { date: '2026-11-20', type: 'income', amountCents: 50_000, recurringRuleId: null, recurringOccurrenceDate: null },
      ],
      recurringRules: [{ id: 'rent', type: 'expense', amountCents: 12_000, frequency: 'monthly', startDate: '2026-01-31', endDate: null }],
    };
    const result = buildForecast(snapshot, input, today);
    expect(result.plannedEvents).toBe(4);
    expect(result.months.map((month) => month.baselineCents)).toEqual([
      5_000_000 - 12_000,
      5_000_000 - 24_000 + 50_000,
      5_000_000 - 36_000 + 50_000,
    ]);
  });

  it('applies a purchase virtually, only from its date, without modifying the baseline', () => {
    const scenario = { title: 'Ноутбук', amountCents: 90_000, date: '2026-11-10' };
    const result = buildForecast(base, { months: 3, scenario }, today);
    expect(result.months.map((month) => [month.baselineCents, month.scenarioCents])).toEqual([
      [5_000_000, 5_000_000], [5_000_000, 4_910_000], [5_000_000, 4_910_000],
    ]);
    expect(base.bookedBalanceCents).toBe(4_000_000);
  });

  it('detects a negative intermediate balance even if the end of month is positive', () => {
    const result = buildForecast({ ...base,
      futureTransactions: [
        { date: '2026-11-05', type: 'expense', amountCents: 6_000_000, recurringRuleId: null, recurringOccurrenceDate: null },
        { date: '2026-11-15', type: 'income', amountCents: 7_000_000, recurringRuleId: null, recurringOccurrenceDate: null },
      ],
    }, input, today);
    expect(result.baseline.firstNegativeDate).toBe('2026-11-05');
    expect(result.baseline.lowestBalanceCents).toBe(-1_000_000);
    expect(result.months[1]?.baselineCents).toBe(6_000_000);
  });

  it('reports an initially negative balance from today', () => {
    const result = buildForecast({ ...base, bookedBalanceCents: -2_000_000 }, input, today);
    expect(result.baseline.firstNegativeDate).toBe(today);
    expect(result.baseline.lowestBalanceCents).toBe(-1_000_000);
  });

  it('validates the request and rejects purchases outside the selected horizon', async () => {
    let reads = 0;
    const forecast: ForecastRepository = {
      async readSnapshot() { reads += 1; return base; },
    };
    const app = createApp({ repository: transactions, forecast, now: () => new Date('2026-10-20T12:00:00Z'), clientOrigin: 'http://localhost:5173' });
    const ok = await request(app).post('/api/forecast/simulate').send({ months: 3, scenario: null });
    expect(ok.status).toBe(200);
    expect(ok.body.data.months).toHaveLength(3);
    for (const payload of [
      { months: 4, scenario: null },
      { months: 3, scenario: { title: 'Товар', amountCents: 1, date: '2026-10-20' } },
      { months: 3, scenario: { title: 'Товар', amountCents: 1, date: '2027-01-01' } },
      { months: 3, scenario: { title: 'Товар', amountCents: -2, date: '2026-11-20' } },
      { months: 3, scenario: { title: 'Товар', amountCents: 1.5, date: '2026-11-20' } },
      { months: 3, scenario: { title: 'Товар', amountCents: 1, date: '2026-02-30' } },
      { months: 3, scenario: null, extra: 'unexpected' },
    ]) {
      expect((await request(app).post('/api/forecast/simulate').send(payload)).status).toBe(422);
    }
    expect(reads).toBe(1);
  });
});

describe('combined forecast plans', () => {
  it('adds a one-time expense and monthly income without changing the baseline', () => {
    const plan = { kind: 'plan' as const, title: 'Новый бюджет', changes: [
      { title: 'Подработка', type: 'income' as const, frequency: 'monthly' as const, amountCents: 100_000, date: '2026-10-31' },
      { title: 'Техника', type: 'expense' as const, frequency: 'once' as const, amountCents: 250_000, date: '2026-11-10' },
    ] };
    const result = buildForecast(base, { months: 3, scenario: plan }, today);
    expect(result.months.map((item) => item.baselineCents)).toEqual([5_000_000, 5_000_000, 5_000_000]);
    expect(result.months.map((item) => item.scenarioCents)).toEqual([5_100_000, 4_950_000, 5_050_000]);
    expect(result.months.map((item) => [item.incomeCents, item.expenseCents])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(result.plannedEvents).toBe(0);
    expect(result.scenario).toEqual(plan);
    expect(base.futureTransactions).toHaveLength(0);
  });

  it('models reduced expenses as virtual savings', () => {
    const scenario = { kind: 'plan' as const, title: 'Экономия', changes: [
      { title: 'Подписки', type: 'saving' as const, frequency: 'monthly' as const, amountCents: 2_000, date: '2026-11-01' },
    ] };
    const result = buildForecast(base, { months: 3, scenario }, today);
    expect(result.months.map((month) => month.scenarioCents)).toEqual([5_000_000, 5_002_000, 5_004_000]);
    expect(result.months[2]?.expenseCents).toBe(0);
  });

  it('anchors the 31st on the last day of shorter months', () => {
    const scenario = { kind: 'plan' as const, title: 'Аренда', changes: [
      { title: 'Платёж', type: 'expense' as const, frequency: 'monthly' as const, amountCents: 1_000, date: '2028-01-31' },
    ] };
    const result = buildForecast(base, { months: 3, scenario }, '2028-01-15');
    expect(result.months.map((item) => item.scenarioCents)).toEqual([4_999_000, 4_998_000, 4_997_000]);
  });

  it('reports a temporary shortfall caused by virtual events', () => {
    const scenario = { kind: 'plan' as const, title: 'Расход и доход', changes: [
      { title: 'Счёт', type: 'expense' as const, frequency: 'once' as const, amountCents: 6_000_000, date: '2026-11-05' },
      { title: 'Поступление', type: 'income' as const, frequency: 'once' as const, amountCents: 7_000_000, date: '2026-11-15' },
    ] };
    const result = buildForecast(base, { months: 3, scenario }, today);
    expect(result.baseline.firstNegativeDate).toBeNull();
    expect(result.withScenario.firstNegativeDate).toBe('2026-11-05');
    expect(result.withScenario.lowestBalanceCents).toBe(-1_000_000);
    expect(result.months[1]?.scenarioCents).toBe(6_000_000);
  });

  it('rejects invalid and out-of-range plans before reading the database', async () => {
    let reads = 0;
    const forecast: ForecastRepository = { async readSnapshot() { reads += 1; return base; } };
    const app = createApp({ repository: transactions, forecast, now: () => new Date('2026-10-20T12:00:00Z'), clientOrigin: 'http://localhost:5173' });
    const change = { title: 'Доход', type: 'income', frequency: 'monthly', amountCents: 100_000, date: '2026-11-01' };
    const scenario = { kind: 'plan', title: 'План', changes: [change] };
    const ok = await request(app).post('/api/forecast/simulate').send({ months: 3, scenario });
    expect(ok.status).toBe(200);
    expect(ok.body.data.months[2].scenarioCents).toBe(5_200_000);
    for (const bad of [
      { ...scenario, changes: [] },
      { ...scenario, changes: Array(6).fill(change) },
      { ...scenario, changes: [{ ...change, date: '2026-10-20' }] },
      { ...scenario, changes: [{ ...change, date: '2027-01-01' }] },
      { ...scenario, changes: [{ ...change, date: '2026-11-31' }] },
      { ...scenario, changes: [{ ...change, amountCents: -1 }] },
      { ...scenario, changes: [{ ...change, frequency: 'daily' }] },
      { ...scenario, changes: [{ ...change, unrelated: true }] },
    ]) {
      expect((await request(app).post('/api/forecast/simulate').send({ months: 3, scenario: bad })).status).toBe(422);
    }
    expect(reads).toBe(1);
  });
});
