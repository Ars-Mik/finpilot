import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Account, AccountInput, AccountTransfer, TransferInput } from './account.schema.js';
import { AccountMissingError, DuplicateAccountNameError, type AccountRepository } from './account.repository.js';

type AccountRow = { id: string; name: string; kind: Account['kind']; openingBalanceCents: string; balanceCents: string };
type TransferRow = { id: string; fromAccountId: string; toAccountId: string; amountCents: string; note: string; date: string };

function safeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Financial amount exceeds JavaScript safe integer range');
  return number;
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, name: row.name, kind: row.kind,
    openingBalanceCents: safeInteger(row.openingBalanceCents), balanceCents: safeInteger(row.balanceCents) };
}

function toTransfer(row: TransferRow): AccountTransfer {
  return { ...row, amountCents: safeInteger(row.amountCents) };
}

// Balances are projections of immutable transfer records and existing transactions.
// No mutable balance column can drift out of sync with the ledger.
const ACCOUNT_BALANCES_SQL = `
  SELECT a.id, a.name, a.kind, a.opening_balance_cents::text AS "openingBalanceCents",
    (a.opening_balance_cents::numeric + COALESCE(t.delta, 0) + COALESCE(f.delta, 0))::text AS "balanceCents"
  FROM accounts a
  LEFT JOIN (
    SELECT account_id, SUM(CASE WHEN type = 'income' THEN amount_cents::numeric ELSE -amount_cents::numeric END) AS delta
    FROM transactions GROUP BY account_id
  ) t ON t.account_id = a.id
  LEFT JOIN (
    SELECT account_id, SUM(delta) AS delta FROM (
      SELECT to_account_id AS account_id, amount_cents::numeric AS delta FROM account_transfers
      UNION ALL
      SELECT from_account_id AS account_id, -amount_cents::numeric AS delta FROM account_transfers
    ) movements GROUP BY account_id
  ) f ON f.account_id = a.id`;

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Account[]> {
    const result = await this.pool.query<AccountRow>(`${ACCOUNT_BALANCES_SQL} ORDER BY a.created_at, a.id`);
    return result.rows.map(toAccount);
  }

  async create(input: AccountInput): Promise<Account> {
    const id = randomUUID();
    try {
      await this.pool.query(
        'INSERT INTO accounts (id, name, kind, opening_balance_cents) VALUES ($1, $2, $3, $4)',
        [id, input.name, input.kind, input.openingBalanceCents],
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new DuplicateAccountNameError('Account name is already in use');
      }
      throw error;
    }
    const result = await this.pool.query<AccountRow>(`${ACCOUNT_BALANCES_SQL} WHERE a.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new Error('Created account could not be loaded');
    return toAccount(row);
  }

  async listTransfers(limit: number): Promise<AccountTransfer[]> {
    const result = await this.pool.query<TransferRow>(`
      SELECT id, from_account_id AS "fromAccountId", to_account_id AS "toAccountId",
        amount_cents::text AS "amountCents", note, date::text AS date
      FROM account_transfers ORDER BY date DESC, created_at DESC, id DESC LIMIT $1`, [limit]);
    return result.rows.map(toTransfer);
  }

  async createTransfer(input: TransferInput): Promise<AccountTransfer> {
    // One INSERT is a single atomic database statement. The transfer's two-sided
    // effect is calculated from the same row, so partial transfers are impossible.
    const id = randomUUID();
    const result = await this.pool.query<TransferRow>(`
      INSERT INTO account_transfers (id, from_account_id, to_account_id, amount_cents, note, date)
      SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::varchar, $6::date
      WHERE EXISTS (SELECT 1 FROM accounts WHERE id = $2::uuid)
        AND EXISTS (SELECT 1 FROM accounts WHERE id = $3::uuid)
      RETURNING id, from_account_id AS "fromAccountId", to_account_id AS "toAccountId",
        amount_cents::text AS "amountCents", note, date::text AS date`,
      [id, input.fromAccountId, input.toAccountId, input.amountCents, input.note, input.date],
    );
    if (!result.rows[0]) throw new AccountMissingError('Transfer account does not exist');
    return toTransfer(result.rows[0]);
  }
}
