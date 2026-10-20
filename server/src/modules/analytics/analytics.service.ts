import type { AnalyticsQuery, AnalyticsReport, MonthlyAnalytics } from './analytics.schema.js';

export type MonthlyRow = { month: string; incomeCents: number; expenseCents: number; transactions: number };
export type CategoryRow = { category: string; expenseCents: number; transactions: number };
export type AccountRow = { accountId: string; accountName: string; incomeCents: number; expenseCents: number };
export type AnalyticsRows = { monthly: MonthlyRow[]; categories: CategoryRow[]; accounts: AccountRow[] };

export function shiftMonth(month: string, offset: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getAnalyticsPeriod({ through, months }: AnalyticsQuery) {
  return {
    from: shiftMonth(through, 1 - months),
    through,
    previousFrom: shiftMonth(through, 1 - months * 2),
    previousThrough: shiftMonth(through, -months),
    exclusiveEnd: shiftMonth(through, 1),
  };
}

function sumSafe(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Analytics totals exceed safe integer range');
  return total;
}

export function buildAnalyticsReport(query: AnalyticsQuery, rows: AnalyticsRows): AnalyticsReport {
  const period = getAnalyticsPeriod(query);
  const byMonth = new Map(rows.monthly.map((row) => [row.month, row]));
  const monthly: MonthlyAnalytics[] = Array.from({ length: query.months }, (_, index) => {
    const month = shiftMonth(period.from, index);
    const row = byMonth.get(month);
    const incomeCents = row?.incomeCents ?? 0;
    const expenseCents = row?.expenseCents ?? 0;
    return { month, incomeCents, expenseCents, netCents: incomeCents - expenseCents, transactions: row?.transactions ?? 0 };
  });
  const previousRows = rows.monthly.filter((row) => row.month >= period.previousFrom && row.month <= period.previousThrough);
  const incomeCents = sumSafe(monthly.map((row) => row.incomeCents));
  const expenseCents = sumSafe(monthly.map((row) => row.expenseCents));
  const previousIncome = sumSafe(previousRows.map((row) => row.incomeCents));
  const previousExpense = sumSafe(previousRows.map((row) => row.expenseCents));
  if (!Number.isSafeInteger(incomeCents - expenseCents) || !Number.isSafeInteger(previousIncome - previousExpense)) {
    throw new Error('Analytics totals exceed safe integer range');
  }
  return {
    period: { from: period.from, through: period.through, months: query.months },
    current: { incomeCents, expenseCents, netCents: incomeCents - expenseCents, transactions: sumSafe(monthly.map((row) => row.transactions)) },
    previous: { from: period.previousFrom, through: period.previousThrough, incomeCents: previousIncome, expenseCents: previousExpense, netCents: previousIncome - previousExpense },
    monthly,
    categories: rows.categories,
    accounts: rows.accounts,
  };
}
