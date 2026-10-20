import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../transactions/transaction.schema.js';

export const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
const limitCentsSchema = z.number().int().min(1).max(1_000_000_000_000);

export const budgetQuerySchema = z.strictObject({ month: monthSchema });
export const budgetInputSchema = z.strictObject({
  month: monthSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  limitCents: limitCentsSchema,
});
export const budgetPatchSchema = z.strictObject({ limitCents: limitCentsSchema });
export const budgetIdSchema = z.uuid();

export type BudgetInput = z.infer<typeof budgetInputSchema>;
export type BudgetPatch = z.infer<typeof budgetPatchSchema>;
export type BudgetCategory = BudgetInput['category'];
export type Budget = BudgetInput & { id: string; spentCents: number; remainingCents: number };
export type BudgetOverview = {
  month: string;
  budgets: Budget[];
  totalLimitCents: number;
  coveredSpentCents: number;
  totalSpentCents: number;
  unbudgetedSpentCents: number;
  overLimitCount: number;
};
