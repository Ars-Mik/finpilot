import { z } from 'zod';

export const analyticsQuerySchema = z.strictObject({
  through: z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
  months: z.coerce.number().int().refine((value) => [3, 6, 12].includes(value)).default(6),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type Totals = { incomeCents: number; expenseCents: number; netCents: number };
export type MonthlyAnalytics = Totals & { month: string; transactions: number };
export type CategoryAnalytics = { category: string; expenseCents: number; transactions: number };
export type AccountAnalytics = { accountId: string; accountName: string; incomeCents: number; expenseCents: number };
export type AnalyticsReport = {
  period: { from: string; through: string; months: number };
  current: Totals & { transactions: number };
  previous: Totals & { from: string; through: string };
  monthly: MonthlyAnalytics[];
  categories: CategoryAnalytics[];
  accounts: AccountAnalytics[];
};
