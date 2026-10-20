import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Transaction, TransactionInput, TransactionQuery } from './transaction.schema.js';
import type { TransactionOverview, TransactionPage, TransactionRepository, TransactionTotals } from './transaction.repository.js';

type TransactionRow = {
  id: string;
  accountId: string;
  title: string;
  amountCents: string;
  type: 'income' | 'expense';
  category: string;
  date: string;
};

type SumRow = { incomeCents: string; expenseCents: string };
type PageTotalsRow = SumRow & { total: string };
type MonthSumRow = SumRow & { month: string };
type CategoryRow = { category: string; amountCents: string };

const SELECT_COLUMNS = `id, account_id AS "accountId", title, amount_cents::text AS "amountCents", type, category, date::text AS date`;
const TOTALS_COLUMNS = `COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0)::text AS "incomeCents",
  COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense'), 0)::text AS "expenseCents"`;

function safeNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Unsafe integer returned by PostgreSQL');
  return number;
}

function toTransaction(row: TransactionRow): Transaction {
  return { ...row, amountCents: safeNumber(row.amountCents) };
}

function toTotals(row: SumRow): TransactionTotals {
  return { incomeCents: safeNumber(row.incomeCents), expenseCents: safeNumber(row.expenseCents) };
}

export class PgTransactionRepository implements TransactionRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: TransactionQuery): Promise<TransactionPage> {
    const filters: string[] = [];
    const values: unknown[] = [];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };

    if (query.type) filters.push(`type = ${add(query.type)}`);
    if (query.month) filters.push(`date >= ${add(`${query.month}-01`)}::date AND date < (${add(`${query.month}-01`)}::date + INTERVAL '1 month')`);
    if (query.search) {
      const escaped = query.search.replace(/[!%_]/g, '!$&');
      const parameter = add(`%${escaped}%`);
      filters.push(`(title ILIKE ${parameter} ESCAPE '!' OR category ILIKE ${parameter} ESCAPE '!')`);
    }

    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const count = await this.pool.query<PageTotalsRow>(
      `SELECT COUNT(*)::text AS total, ${TOTALS_COLUMNS} FROM transactions${where}`, values,
    );
    const summary = count.rows[0];
    if (!summary) throw new Error('Unable to read transaction totals');

    const limit = add(query.limit);
    const offset = add((query.page - 1) * query.limit);
    const rows = await this.pool.query<TransactionRow>(
      `SELECT ${SELECT_COLUMNS} FROM transactions${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return { items: rows.rows.map(toTransaction), total: safeNumber(summary.total), totals: toTotals(summary) };
  }

  async overview(selectedMonth: string, chartMonths: readonly string[]): Promise<TransactionOverview> {
    const [overallResult, selectedResult, chartResult, categoryResult, recentResult, openingResult] = await Promise.all([
      this.pool.query<PageTotalsRow>(`SELECT COUNT(*)::text AS total, ${TOTALS_COLUMNS} FROM transactions`),
      this.pool.query<SumRow>(
        `SELECT ${TOTALS_COLUMNS} FROM transactions WHERE date >= $1::date AND date < ($1::date + INTERVAL '1 month')`,
        [`${selectedMonth}-01`],
      ),
      this.pool.query<MonthSumRow>(
        `SELECT to_char(date, 'YYYY-MM') AS month, ${TOTALS_COLUMNS}
         FROM transactions WHERE date >= $1::date AND date < ($2::date + INTERVAL '1 month')
         GROUP BY month ORDER BY month ASC`,
        [`${chartMonths[0]}-01`, `${chartMonths[chartMonths.length - 1]}-01`],
      ),
      this.pool.query<CategoryRow>(
        `SELECT category, SUM(amount_cents)::text AS "amountCents"
         FROM transactions WHERE type = 'expense' AND date >= $1::date AND date < ($1::date + INTERVAL '1 month')
         GROUP BY category ORDER BY SUM(amount_cents) DESC, category ASC LIMIT 4`,
        [`${selectedMonth}-01`],
      ),
      this.pool.query<TransactionRow>(
        `SELECT ${SELECT_COLUMNS} FROM transactions ORDER BY date DESC, created_at DESC, id DESC LIMIT 5`,
      ),
      this.pool.query<{ openingCents: string }>(
        `SELECT COALESCE(SUM(opening_balance_cents::numeric), 0)::text AS "openingCents" FROM accounts`,
      ),
    ]);

    const overall = overallResult.rows[0];
    const selected = selectedResult.rows[0];
    if (!overall || !selected) throw new Error('Unable to read finance overview');
    const allTotals = toTotals(overall);
    const monthMap = new Map(chartResult.rows.map((row) => [row.month, toTotals(row)]));

    return {
      total: safeNumber(overall.total),
      balanceCents: (() => {
        const total = allTotals.incomeCents - allTotals.expenseCents + safeNumber(openingResult.rows[0]?.openingCents ?? '0');
        if (!Number.isSafeInteger(total)) throw new Error('Finance overview total exceeds safe integer range');
        return total;
      })(),
      selected: toTotals(selected),
      months: chartMonths.map((month) => ({ month, ...(monthMap.get(month) ?? { incomeCents: 0, expenseCents: 0 }) })),
      categories: categoryResult.rows.map((row) => ({ category: row.category, amountCents: safeNumber(row.amountCents) })),
      recent: recentResult.rows.map(toTransaction),
    };
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE id = $1`, [id]);
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async create(input: TransactionInput): Promise<Transaction> {
    const id = randomUUID();
    const result = await this.pool.query<TransactionRow>(
      `INSERT INTO transactions (id, title, amount_cents, type, category, date, account_id)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::uuid, '00000000-0000-4000-8000-000000000001'::uuid)) RETURNING ${SELECT_COLUMNS}`,
      [id, input.title, input.amountCents, input.type, input.category, input.date, input.accountId ?? null],
    );
    if (!result.rows[0]) throw new Error('Insert did not return a row');
    return toTransaction(result.rows[0]);
  }

  async update(id: string, input: TransactionInput): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(
      `UPDATE transactions SET title = $2, amount_cents = $3, type = $4,
       category = $5, date = $6, account_id = COALESCE($7::uuid, account_id), updated_at = NOW() WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
      [id, input.title, input.amountCents, input.type, input.category, input.date, input.accountId ?? null],
    );
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
