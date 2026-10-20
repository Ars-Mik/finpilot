import { ApiError, request } from './transactions';

export type AnalyticsPeriodMonths = 3 | 6 | 12;
export type AnalyticsTotals = { incomeCents: number; expenseCents: number; netCents: number };
export type AnalyticsReport = {
  period: { from: string; through: string; months: number };
  current: AnalyticsTotals & { transactions: number };
  previous: AnalyticsTotals & { from: string; through: string };
  monthly: (AnalyticsTotals & { month: string; transactions: number })[];
  categories: { category: string; expenseCents: number; transactions: number }[];
  accounts: { accountId: string; accountName: string; incomeCents: number; expenseCents: number }[];
};

export async function getAnalytics(through: string, months: AnalyticsPeriodMonths, signal?: AbortSignal): Promise<AnalyticsReport> {
  const params = new URLSearchParams({ through, months: String(months) });
  const result = await request<{ data: AnalyticsReport }>(`/api/analytics?${params}`, { signal });
  if (!result.data || !Array.isArray(result.data.monthly)
    || !Array.isArray(result.data.categories) || !Array.isArray(result.data.accounts)
    || !result.data.current || !result.data.previous || result.data.monthly.length !== months) {
    throw new ApiError('API вернул некорректные данные аналитики.');
  }
  return result.data;
}
