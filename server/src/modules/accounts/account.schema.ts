import { z } from 'zod';

const moneyCents = z.number().int().min(0).max(1_000_000_000_000);

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return value.slice(0, 4) !== '0000' && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export const accountInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['checking', 'savings', 'cash']),
  openingBalanceCents: moneyCents.default(0),
});

export const transferInputSchema = z.strictObject({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amountCents: moneyCents.positive(),
  note: z.string().trim().max(80).default(''),
  date: calendarDate,
}).refine((value) => value.fromAccountId !== value.toAccountId, {
  path: ['toAccountId'], message: 'Accounts must be different',
});

export const transferQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type AccountInput = z.infer<typeof accountInputSchema>;
export type TransferInput = z.infer<typeof transferInputSchema>;
export type Account = AccountInput & { id: string; balanceCents: number };
export type AccountTransfer = TransferInput & { id: string };
