import { z } from 'zod';

const CATEGORIES = {
  income: ['Зарплата', 'Подработка', 'Подарки', 'Другое'],
  expense: ['Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Покупки', 'Досуг', 'Другое'],
} as const;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return value.slice(0, 4) !== '0000' && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

const transactionFields = z.strictObject({
  title: z.string().trim().min(1).max(80),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  type: z.enum(['income', 'expense']),
  category: z.string().trim().min(1).max(60),
  date: dateSchema,
  accountId: z.uuid().optional(),
});

export const transactionInputSchema = transactionFields.superRefine((value, context) => {
  if (!(CATEGORIES[value.type] as readonly string[]).includes(value.category)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Category does not match transaction type' });
  }
});

export const transactionPatchSchema = transactionFields.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field',
);

export const transactionQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: z.enum(['income', 'expense']).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  search: z.string().trim().max(100).optional(),
});

export const overviewQuerySchema = z.strictObject({
  month: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
  currentMonth: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
});

export const transactionIdSchema = z.uuid();

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransactionPatch = z.infer<typeof transactionPatchSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

export type Transaction = Omit<TransactionInput, 'accountId'> & { id: string; accountId: string };
