import { z } from 'zod';

const dateSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

export const forecastRequestSchema = z.strictObject({
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  scenario: z.strictObject({
    title: z.string().trim().min(1).max(80),
    amountCents: z.number().int().min(1).max(1_000_000_000_000),
    date: dateSchema,
  }).nullable(),
});

export type ForecastRequest = z.infer<typeof forecastRequestSchema>;
export type ForecastScenario = NonNullable<ForecastRequest['scenario']>;

export type ForecastRule = {
  id: string;
  type: 'income' | 'expense';
  amountCents: number;
  frequency: 'weekly' | 'monthly';
  startDate: string;
  endDate: string | null;
};

export type ForecastTransaction = {
  date: string;
  type: 'income' | 'expense';
  amountCents: number;
  recurringRuleId: string | null;
  recurringOccurrenceDate: string | null;
};

export type ForecastSnapshot = {
  openingBalanceCents: number;
  bookedBalanceCents: number;
  futureTransactions: ForecastTransaction[];
  recurringRules: ForecastRule[];
};

export type ForecastMonth = {
  month: string;
  baselineCents: number;
  scenarioCents: number;
  incomeCents: number;
  expenseCents: number;
};

export type ForecastPath = {
  lowestBalanceCents: number;
  firstNegativeDate: string | null;
};

export type ForecastResult = {
  asOf: string;
  through: string;
  currentBalanceCents: number;
  plannedEvents: number;
  scenario: ForecastScenario | null;
  baseline: ForecastPath;
  withScenario: ForecastPath;
  months: ForecastMonth[];
};
