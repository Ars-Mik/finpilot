import type { Pool } from 'pg';
import type { ForecastRepository } from './forecast.repository.js';
import type { ForecastRule, ForecastSnapshot, ForecastTransaction } from './forecast.schema.js';

type MoneyRow = { amountCents: string };
type TransactionRow = Omit<ForecastTransaction, 'amountCents'> & { amountCents: string };
type RuleRow = Omit<ForecastRule, 'amountCents'> & { amountCents: string };

function safeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Forecast value exceeds safe integer range');
  return number;
}

export class PgForecastRepository implements ForecastRepository {
  constructor(private readonly pool: Pool) {}

  async readSnapshot(asOf: string, through: string): Promise<ForecastSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const opening = await client.query<MoneyRow>(
        `SELECT COALESCE(SUM(opening_balance_cents::numeric), 0)::text AS "amountCents" FROM accounts`,
      );
      const booked = await client.query<MoneyRow>(
        `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents::numeric ELSE -amount_cents::numeric END), 0)::text AS "amountCents"
         FROM transactions WHERE date <= $1::date`, [asOf],
      );
      const future = await client.query<TransactionRow>(
        `SELECT date::text AS date, type, amount_cents::text AS "amountCents",
           recurring_rule_id AS "recurringRuleId", recurring_occurrence_date::text AS "recurringOccurrenceDate"
         FROM transactions WHERE date > $1::date AND date <= $2::date ORDER BY date, id`, [asOf, through],
      );
      const rules = await client.query<RuleRow>(
        `SELECT id, type, amount_cents::text AS "amountCents", frequency,
           start_date::text AS "startDate", end_date::text AS "endDate"
         FROM recurring_rules WHERE enabled = TRUE AND start_date <= $1::date ORDER BY id`, [through],
      );
      await client.query('COMMIT');
      return {
        openingBalanceCents: safeInteger(opening.rows[0]?.amountCents ?? '0'),
        bookedBalanceCents: safeInteger(booked.rows[0]?.amountCents ?? '0'),
        futureTransactions: future.rows.map((row) => ({ ...row, amountCents: safeInteger(row.amountCents) })),
        recurringRules: rules.rows.map((row) => ({ ...row, amountCents: safeInteger(row.amountCents) })),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
