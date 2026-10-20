import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { nextOccurrences, occurrencesBetween, oneYearBack } from './schedule.js';
import type { RecurringInput, RecurringRule, RecurringWithPreview, ApplyResult } from './recurring.schema.js';
import type { RecurringRepository } from './recurring.repository.js';

type RuleRow = {
  id: string; title: string; type: RecurringRule['type']; category: string;
  amountCents: string; accountId: string; frequency: RecurringRule['frequency'];
  startDate: string; endDate: string | null; enabled: boolean;
};

const COLUMNS = `id, title, type, category, amount_cents::text AS "amountCents", account_id AS "accountId",
  frequency, start_date::text AS "startDate", end_date::text AS "endDate", enabled`;

function toRule(row: RuleRow): RecurringRule {
  const amountCents = Number(row.amountCents);
  if (!Number.isSafeInteger(amountCents)) throw new Error('Recurring amount is outside the safe range');
  return { ...row, amountCents };
}

export class PgRecurringRepository implements RecurringRepository {
  constructor(private readonly pool: Pool) {}

  async list(on: string): Promise<RecurringWithPreview[]> {
    const result = await this.pool.query<RuleRow>(`SELECT ${COLUMNS} FROM recurring_rules ORDER BY created_at DESC, id DESC`);
    return result.rows.map(toRule).map((rule) => ({
      ...rule, upcoming: rule.enabled ? nextOccurrences(rule, on) : [],
    }));
  }

  async create(input: RecurringInput): Promise<{ id: string }> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO recurring_rules
       (id, title, type, category, amount_cents, account_id, frequency, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date)`,
      [id, input.title, input.type, input.category, input.amountCents, input.accountId,
        input.frequency, input.startDate, input.endDate],
    );
    return { id };
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE recurring_rules SET enabled = $2, updated_at = NOW() WHERE id = $1', [id, enabled],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async applyDue(today: string): Promise<ApplyResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock schedules so a simultaneous disable/edit cannot interleave with posting.
      const rules = await client.query<RuleRow>(
        `SELECT ${COLUMNS} FROM recurring_rules
         WHERE enabled = TRUE AND start_date <= $1::date ORDER BY id FOR UPDATE`, [today],
      );
      const from = oneYearBack(today);
      let created = 0;
      let alreadyRecorded = 0;

      for (const row of rules.rows) {
        const rule = toRule(row);
        const dates = occurrencesBetween(rule, from, today);
        for (const date of dates) {
          const result = await client.query(
            `INSERT INTO transactions
             (id, title, type, category, amount_cents, account_id, date, recurring_rule_id, recurring_occurrence_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $7::date)
             ON CONFLICT (recurring_rule_id, recurring_occurrence_date)
               WHERE recurring_rule_id IS NOT NULL DO NOTHING`,
            [randomUUID(), rule.title, rule.type, rule.category, rule.amountCents, rule.accountId, date, rule.id],
          );
          if ((result.rowCount ?? 0) > 0) created += 1;
          else alreadyRecorded += 1;
        }
      }
      await client.query('COMMIT');
      return { created, alreadyRecorded };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
