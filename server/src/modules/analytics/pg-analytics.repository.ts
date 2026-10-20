import type { Pool } from 'pg';
import type { AnalyticsQuery, AnalyticsReport } from './analytics.schema.js';
import type { AnalyticsRepository } from './analytics.repository.js';
import { buildAnalyticsReport, getAnalyticsPeriod, type MonthlyRow, type CategoryRow, type AccountRow } from './analytics.service.js';

type MoneyRow = { incomeCents: string; expenseCents: string };
type MonthlySqlRow = MoneyRow & { month: string; transactions: string };
type CategorySqlRow = { category: string; expenseCents: string; transactions: string };
type AccountSqlRow = MoneyRow & { accountId: string; accountName: string };

function safeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Unsafe analytics value returned by PostgreSQL');
  return number;
}

const totalsSql = `COALESCE(SUM(amount_cents::numeric) FILTER (WHERE type = 'income'), 0)::text AS "incomeCents",
  COALESCE(SUM(amount_cents::numeric) FILTER (WHERE type = 'expense'), 0)::text AS "expenseCents"`;

export class PgAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly pool: Pool) {}

  async report(query: AnalyticsQuery): Promise<AnalyticsReport> {
    const period = getAnalyticsPeriod(query);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const monthlyResult = await client.query<MonthlySqlRow>(
        `SELECT to_char(date, 'YYYY-MM') AS month, COUNT(*)::text AS transactions, ${totalsSql}
         FROM transactions WHERE date >= $1::date AND date < $2::date
         GROUP BY to_char(date, 'YYYY-MM') ORDER BY month`,
        [`${period.previousFrom}-01`, `${period.exclusiveEnd}-01`],
      );
      const categoryResult = await client.query<CategorySqlRow>(
        `SELECT category, COUNT(*)::text AS transactions,
           SUM(amount_cents::numeric)::text AS "expenseCents"
         FROM transactions WHERE type = 'expense' AND date >= $1::date AND date < $2::date
         GROUP BY category ORDER BY SUM(amount_cents::numeric) DESC, category ASC`,
        [`${period.from}-01`, `${period.exclusiveEnd}-01`],
      );
      const accountResult = await client.query<AccountSqlRow>(
        `SELECT a.id AS "accountId", a.name AS "accountName", ${totalsSql}
         FROM transactions t INNER JOIN accounts a ON a.id = t.account_id
         WHERE t.date >= $1::date AND t.date < $2::date
         GROUP BY a.id, a.name ORDER BY SUM(t.amount_cents::numeric) DESC, a.name ASC`,
        [`${period.from}-01`, `${period.exclusiveEnd}-01`],
      );
      await client.query('COMMIT');

      const monthly: MonthlyRow[] = monthlyResult.rows.map((row) => ({
        month: row.month, transactions: safeInteger(row.transactions),
        incomeCents: safeInteger(row.incomeCents), expenseCents: safeInteger(row.expenseCents),
      }));
      const categories: CategoryRow[] = categoryResult.rows.map((row) => ({
        category: row.category, transactions: safeInteger(row.transactions), expenseCents: safeInteger(row.expenseCents),
      }));
      const accounts: AccountRow[] = accountResult.rows.map((row) => ({
        accountId: row.accountId, accountName: row.accountName,
        incomeCents: safeInteger(row.incomeCents), expenseCents: safeInteger(row.expenseCents),
      }));
      return buildAnalyticsReport(query, { monthly, categories, accounts });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
