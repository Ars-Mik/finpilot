import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Transaction, TransactionInput, TransactionQuery } from './transaction.schema.js';
import type { TransactionPage, TransactionRepository } from './transaction.repository.js';

type TransactionRow = {
  id: string;
  title: string;
  amountCents: string;
  type: 'income' | 'expense';
  category: string;
  date: string;
};

const SELECT_COLUMNS = `id, title, amount_cents::text AS "amountCents", type, category, date::text AS date`;

function toTransaction(row: TransactionRow): Transaction {
  const amountCents = Number(row.amountCents);
  if (!Number.isSafeInteger(amountCents)) throw new Error('Unsafe amount returned by PostgreSQL');
  return { ...row, amountCents };
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
    const count = await this.pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM transactions${where}`, values);
    const total = Number(count.rows[0]?.total ?? '0');
    const limit = add(query.limit);
    const offset = add((query.page - 1) * query.limit);
    const rows = await this.pool.query<TransactionRow>(
      `SELECT ${SELECT_COLUMNS} FROM transactions${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return { items: rows.rows.map(toTransaction), total };
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE id = $1`, [id]);
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async create(input: TransactionInput): Promise<Transaction> {
    const id = randomUUID();
    const result = await this.pool.query<TransactionRow>(
      `INSERT INTO transactions (id, title, amount_cents, type, category, date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SELECT_COLUMNS}`,
      [id, input.title, input.amountCents, input.type, input.category, input.date],
    );
    if (!result.rows[0]) throw new Error('Insert did not return a row');
    return toTransaction(result.rows[0]);
  }

  async update(id: string, input: TransactionInput): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(
      `UPDATE transactions SET title = $2, amount_cents = $3, type = $4,
       category = $5, date = $6, updated_at = NOW() WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
      [id, input.title, input.amountCents, input.type, input.category, input.date],
    );
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
