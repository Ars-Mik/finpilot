import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../transactions/transaction.schema.js';

const categories = {
  income: ['Зарплата', 'Подработка', 'Подарки', 'Другое'],
  expense: EXPENSE_CATEGORIES,
} as const;

const dateSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

export const recurringInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  type: z.enum(['income', 'expense']),
  category: z.string().trim().min(1).max(60),
  amountCents: z.number().int().min(1).max(1_000_000_000_000),
  accountId: z.uuid(),
  frequency: z.enum(['weekly', 'monthly']),
  startDate: dateSchema,
  endDate: dateSchema.nullable().default(null),
}).superRefine((value, context) => {
  if (!(categories[value.type] as readonly string[]).includes(value.category)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Category does not match type' });
  }
  if (value.endDate !== null && value.endDate < value.startDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must not precede start date' });
  }
});

export const recurringIdSchema = z.uuid();
export const recurringToggleSchema = z.strictObject({ enabled: z.boolean() });
export const recurringQuerySchema = z.strictObject({ on: dateSchema });

export type RecurringInput = z.infer<typeof recurringInputSchema>;
export type RecurringRule = RecurringInput & { id: string; enabled: boolean };
export type RecurringWithPreview = RecurringRule & { upcoming: string[] };
export type ApplyResult = { created: number; alreadyRecorded: number };
