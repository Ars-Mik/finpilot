import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Budget, BudgetInput, BudgetPatch, BudgetOverview } from './budget.schema.js';
import { DuplicateBudgetError, type BudgetRepository } from './budget.repository.js';

type BudgetRow = {
  id: string | null;
  category: BudgetInput['category'];
  limitCents: string | null;
  spentCents: string;
};

function asSafeInteger(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Financial aggregate exceeds safe integer range');
  return amount;
}

// One query covers categories with limits and spending in categories without a limit.
// A user's account transfers do not appear in transactions, so they cannot inflate expenses.
const OVERVIEW_SQL = `
  WITH spending AS (
    SELECT category, SUM(amount_cents::numeric) AS spent
    FROM transactions
    WHERE type = 'expense'
      AND date >= $1::date AND date < ($1::date + INTERVAL '1 month')
    GROUP BY category
  ), categories AS (
    SELECT category FROM spending
    UNION
    SELECT category FROM monthly_budgets WHERE month = $1::date
  )
  SELECT b.id, categories.category,
    b.limit_cents::text AS "limitCents",
    COALESCE(s.spent, 0)::text AS "spentCents"
  FROM categories
  LEFT JOIN monthly_budgets b ON b.month = $1::date AND b.category = categories.category
  LEFT JOIN spending s ON s.category = categories.category
  ORDER BY categories.category
`;

export class PgBudgetRepository implements BudgetRepository {
  constructor(private readonly pool: Pool) {}

  async overview(month: string): Promise<BudgetOverview> {
    const result = await this.pool.query<BudgetRow>(OVERVIEW_SQL, [`${month}-01`]);
    const budgets: Budget[] = [];
    let totalSpentCents = 0;
    let coveredSpentCents = 0;
    let totalLimitCents = 0;
    let overLimitCount = 0;

    for (const row of result.rows) {
      const spentCents = asSafeInteger(row.spentCents);
      totalSpentCents += spentCents;
      if (row.id === null || row.limitCents === null) continue;
      const limitCents = asSafeInteger(row.limitCents);
      const remainingCents = limitCents - spentCents;
      budgets.push({ id: row.id, month, category: row.category, limitCents, spentCents, remainingCents });
      totalLimitCents += limitCents;
      coveredSpentCents += spentCents;
      if (remainingCents < 0) overLimitCount += 1;
    }

    const unbudgetedSpentCents = totalSpentCents - coveredSpentCents;
    for (const amount of [totalSpentCents, coveredSpentCents, totalLimitCents, unbudgetedSpentCents]) {
      if (!Number.isSafeInteger(amount)) throw new Error('Financial aggregate exceeds safe integer range');
    }
    return { month, budgets, totalLimitCents, coveredSpentCents, totalSpentCents, unbudgetedSpentCents, overLimitCount };
  }

  async create(input: BudgetInput): Promise<{ id: string } & BudgetInput> {
    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO monthly_budgets (id, month, category, limit_cents)
         VALUES ($1, $2::date, $3, $4)`,
        [id, `${input.month}-01`, input.category, input.limitCents],
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new DuplicateBudgetError('Budget already exists for this month and category');
      }
      throw error;
    }
    return { id, ...input };
  }

  async update(id: string, patch: BudgetPatch): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE monthly_budgets SET limit_cents = $2, updated_at = NOW() WHERE id = $1`,
      [id, patch.limitCents],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM monthly_budgets WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
