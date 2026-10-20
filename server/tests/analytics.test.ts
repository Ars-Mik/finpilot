import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildAnalyticsReport, getAnalyticsPeriod, shiftMonth } from '../src/modules/analytics/analytics.service.js';
import type { AnalyticsRepository } from '../src/modules/analytics/analytics.repository.js';
import type { AnalyticsQuery } from '../src/modules/analytics/analytics.schema.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

const fakeTransactions = {} as TransactionRepository;
const sampleRows = {
  monthly: [
    { month: '2026-01', incomeCents: 20_000, expenseCents: 10_000, transactions: 2 },
    { month: '2026-04', incomeCents: 80_000, expenseCents: 40_000, transactions: 3 },
    { month: '2026-05', incomeCents: 50_000, expenseCents: 15_000, transactions: 2 },
    { month: '2026-06', incomeCents: 0, expenseCents: 5_000, transactions: 1 },
  ],
  categories: [{ category: 'Продукты', expenseCents: 60_000, transactions: 4 }],
  accounts: [{ accountId: 'one', accountName: 'Основной', incomeCents: 130_000, expenseCents: 60_000 }],
};

class FakeAnalyticsRepository implements AnalyticsRepository {
  async report(query: AnalyticsQuery) { return buildAnalyticsReport(query, sampleRows); }
}

function setup() {
  return createApp({ repository: fakeTransactions, analytics: new FakeAnalyticsRepository(), clientOrigin: 'http://localhost:5173' });
}

describe('analytics API', () => {
  it('rejects invalid dates, unsupported periods, and unknown query keys', async () => {
    for (const path of ['/api/analytics', '/api/analytics?through=2026-13', '/api/analytics?through=2026-10&months=5', '/api/analytics?through=2026-10&extra=1']) {
      const result = await request(setup()).get(path);
      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns the full report through HTTP', async () => {
    const response = await request(setup()).get('/api/analytics?through=2026-06&months=3');
    expect(response.status).toBe(200);
    expect(response.body.data.period).toEqual({ from: '2026-04', through: '2026-06', months: 3 });
    expect(response.body.data.current).toEqual({ incomeCents: 130_000, expenseCents: 60_000, netCents: 70_000, transactions: 6 });
    expect(response.body.data.previous).toEqual({ from: '2026-01', through: '2026-03', incomeCents: 20_000, expenseCents: 10_000, netCents: 10_000 });
  });

  it('fills empty months and does not include previous months in the current totals', () => {
    const report = buildAnalyticsReport({ through: '2026-06', months: 6 }, sampleRows);
    expect(report.monthly).toHaveLength(6);
    expect(report.monthly[1]).toEqual({ month: '2026-02', incomeCents: 0, expenseCents: 0, netCents: 0, transactions: 0 });
    expect(report.monthly[3]?.month).toBe('2026-04');
    expect(report.current.netCents).toBe(80_000);
  });

  it('handles December / January boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(getAnalyticsPeriod({ through: '2026-01', months: 3 })).toEqual({
      from: '2025-11', through: '2026-01', previousFrom: '2025-08', previousThrough: '2025-10', exclusiveEnd: '2026-02',
    });
  });

  it('reports zero amounts without dividing by zero', () => {
    const report = buildAnalyticsReport({ through: '2026-06', months: 3 }, { monthly: [], categories: [], accounts: [] });
    expect(report.current).toEqual({ incomeCents: 0, expenseCents: 0, netCents: 0, transactions: 0 });
    expect(report.categories).toEqual([]);
  });

  it('rejects totals beyond JavaScript safe integer range', () => {
    expect(() => buildAnalyticsReport({ through: '2026-06', months: 3 }, {
      monthly: [
        { month: '2026-05', incomeCents: Number.MAX_SAFE_INTEGER, expenseCents: 0, transactions: 1 },
        { month: '2026-06', incomeCents: 1, expenseCents: 0, transactions: 1 },
      ], categories: [], accounts: [],
    })).toThrow('safe integer');
  });
});
