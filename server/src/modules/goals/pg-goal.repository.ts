import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { GoalRepository } from './goal.repository.js';
import { GoalConflictError, GoalMissingError } from './goal.repository.js';
import type { AllocationInput, Goal, GoalAllocation, GoalCreate, GoalPatch } from './goal.schema.js';

type GoalRow = {
  id: string; accountId: string; name: string; targetCents: string; dueDate: string;
  status: Goal['status']; reservedCents: string; accountBalanceCents: string; accountReservedCents: string;
};

function safeCents(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Financial amount exceeds safe integer range');
  return number;
}

function mapGoal(row: GoalRow): Goal {
  const targetCents = safeCents(row.targetCents);
  const reservedCents = safeCents(row.reservedCents);
  return {
    id: row.id, accountId: row.accountId, name: row.name, targetCents, dueDate: row.dueDate,
    status: row.status, reservedCents, remainingCents: Math.max(0, targetCents - reservedCents),
    accountBalanceCents: safeCents(row.accountBalanceCents), accountReservedCents: safeCents(row.accountReservedCents),
  };
}

// These values are projections. Reservations never modify account balances.
const GOALS_SQL = `
  WITH amounts AS (
    SELECT goal_id, SUM(delta_cents::numeric) AS amount
    FROM goal_allocations GROUP BY goal_id
  ), reserves AS (
    SELECT g.account_id, SUM(COALESCE(am.amount, 0)) AS amount
    FROM savings_goals g LEFT JOIN amounts am ON am.goal_id = g.id
    WHERE g.status = 'active' GROUP BY g.account_id
  ), movements AS (
    SELECT account_id, SUM(delta) AS amount FROM (
      SELECT account_id, CASE WHEN type = 'income' THEN amount_cents::numeric ELSE -amount_cents::numeric END AS delta FROM transactions
      UNION ALL SELECT to_account_id, amount_cents::numeric FROM account_transfers
      UNION ALL SELECT from_account_id, -amount_cents::numeric FROM account_transfers
    ) entries GROUP BY account_id
  )
  SELECT g.id, g.account_id AS "accountId", g.name, g.target_cents::text AS "targetCents",
    g.due_date::text AS "dueDate", g.status,
    COALESCE(am.amount, 0)::text AS "reservedCents",
    (a.opening_balance_cents::numeric + COALESCE(m.amount, 0))::text AS "accountBalanceCents",
    COALESCE(r.amount, 0)::text AS "accountReservedCents"
  FROM savings_goals g
  JOIN accounts a ON a.id = g.account_id
  LEFT JOIN amounts am ON am.goal_id = g.id
  LEFT JOIN reserves r ON r.account_id = g.account_id
  LEFT JOIN movements m ON m.account_id = g.account_id`;

export class PgGoalRepository implements GoalRepository {
  constructor(private readonly pool: Pool) {}

  private async one(id: string): Promise<Goal | null> {
    const result = await this.pool.query<GoalRow>(`${GOALS_SQL} WHERE g.id = $1`, [id]);
    return result.rows[0] ? mapGoal(result.rows[0]) : null;
  }

  async list(): Promise<Goal[]> {
    const result = await this.pool.query<GoalRow>(`${GOALS_SQL} ORDER BY g.created_at, g.id`);
    return result.rows.map(mapGoal);
  }

  async create(input: GoalCreate): Promise<Goal> {
    const id = randomUUID();
    const result = await this.pool.query(`
      INSERT INTO savings_goals (id, account_id, name, target_cents, due_date)
      SELECT $1::uuid, id, $3, $4, $5::date FROM accounts WHERE id = $2::uuid
      RETURNING id`, [id, input.accountId, input.name, input.targetCents, input.dueDate]);
    if (!result.rowCount) throw new GoalMissingError('Account not found');
    const created = await this.one(id);
    if (!created) throw new Error('Created goal not found');
    return created;
  }

  async update(id: string, patch: GoalPatch): Promise<Goal | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        "SELECT id FROM savings_goals WHERE id = $1 AND status = 'active' FOR UPDATE", [id],
      );
      if (!locked.rows[0]) { await client.query('ROLLBACK'); return null; }
      const reserved = await client.query<{ amount: string }>(
        'SELECT COALESCE(SUM(delta_cents::numeric), 0)::text AS amount FROM goal_allocations WHERE goal_id = $1', [id],
      );
      if (patch.targetCents !== undefined && patch.targetCents < safeCents(reserved.rows[0]!.amount)) {
        throw new GoalConflictError('Goal target cannot be less than reserved funds');
      }
      await client.query(`UPDATE savings_goals SET name = COALESCE($2, name),
        target_cents = COALESCE($3, target_cents), due_date = COALESCE($4::date, due_date),
        updated_at = NOW() WHERE id = $1`, [id, patch.name ?? null, patch.targetCents ?? null, patch.dueDate ?? null]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return this.one(id);
  }

  async allocate(id: string, input: AllocationInput): Promise<Goal> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lookup = await client.query<{ accountId: string }>(
        'SELECT account_id AS "accountId" FROM savings_goals WHERE id = $1', [id],
      );
      const accountId = lookup.rows[0]?.accountId;
      if (!accountId) throw new GoalMissingError('Goal not found');
      // Serialize reservations for every goal on this account.
      const accountLock = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!accountLock.rowCount) throw new GoalMissingError('Account not found');
      const target = await client.query<{ targetCents: string; status: Goal['status'] }>(
        'SELECT target_cents::text AS "targetCents", status FROM savings_goals WHERE id = $1 FOR UPDATE', [id],
      );
      const row = target.rows[0];
      if (!row) throw new GoalMissingError('Goal not found');
      const reservedResult = await client.query<{ amount: string }>(
        'SELECT COALESCE(SUM(delta_cents::numeric), 0)::text AS amount FROM goal_allocations WHERE goal_id = $1', [id],
      );
      if (row.status !== 'active') throw new GoalConflictError('Goal is archived');
      const reserved = safeCents(reservedResult.rows[0]!.amount);
      const delta = input.action === 'reserve' ? input.amountCents : -input.amountCents;
      if (reserved + delta < 0 || reserved + delta > safeCents(row.targetCents)) {
        throw new GoalConflictError('Reservation exceeds goal limits');
      }
      if (delta > 0) {
        const result = await client.query<{ balance: string; allocated: string }>(`
          SELECT (a.opening_balance_cents::numeric
              + COALESCE((SELECT SUM(CASE WHEN type = 'income' THEN amount_cents::numeric ELSE -amount_cents::numeric END)
                   FROM transactions WHERE account_id = a.id), 0)
              + COALESCE((SELECT SUM(delta) FROM (
                  SELECT amount_cents::numeric AS delta FROM account_transfers WHERE to_account_id = a.id
                  UNION ALL SELECT -amount_cents::numeric FROM account_transfers WHERE from_account_id = a.id
                ) t), 0))::text AS balance,
            COALESCE((SELECT SUM(ga.delta_cents::numeric) FROM goal_allocations ga
              JOIN savings_goals g ON g.id = ga.goal_id
              WHERE g.account_id = a.id AND g.status = 'active'), 0)::text AS allocated
          FROM accounts a WHERE a.id = $1`, [accountId]);
        const available = safeCents(result.rows[0]!.balance) - safeCents(result.rows[0]!.allocated);
        if (delta > available) throw new GoalConflictError('Insufficient unreserved account funds');
      }
      await client.query('INSERT INTO goal_allocations (id, goal_id, delta_cents) VALUES ($1, $2, $3)',
        [randomUUID(), id, delta]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    const goal = await this.one(id);
    if (!goal) throw new Error('Updated goal not found');
    return goal;
  }

  async archive(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ accountId: string }>(
        'SELECT account_id AS "accountId" FROM savings_goals WHERE id = $1', [id]);
      if (!result.rows[0]) { await client.query('ROLLBACK'); return false; }
      await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [result.rows[0].accountId]);
      const locked = await client.query<{ status: Goal['status'] }>(
        'SELECT status FROM savings_goals WHERE id = $1 FOR UPDATE', [id],
      );
      const goal = locked.rows[0];
      if (!goal) { await client.query('ROLLBACK'); return false; }
      if (goal.status === 'active') {
        const reserved = await client.query<{ amount: string }>(
          'SELECT COALESCE(SUM(delta_cents::numeric), 0)::text AS amount FROM goal_allocations WHERE goal_id = $1', [id],
        );
        const amount = safeCents(reserved.rows[0]!.amount);
        if (amount > 0) await client.query(
          'INSERT INTO goal_allocations (id, goal_id, delta_cents, note) VALUES ($1, $2, $3, $4)',
          [randomUUID(), id, -amount, 'Archive release'],
        );
        await client.query("UPDATE savings_goals SET status = 'archived', updated_at = NOW() WHERE id = $1", [id]);
      }
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async history(id: string): Promise<GoalAllocation[] | null> {
    const found = await this.pool.query('SELECT id FROM savings_goals WHERE id = $1', [id]);
    if (!found.rowCount) return null;
    const result = await this.pool.query<{ id: string; goalId: string; deltaCents: string; createdAt: string }>(`
      SELECT id, goal_id AS "goalId", delta_cents::text AS "deltaCents", created_at::text AS "createdAt"
      FROM goal_allocations WHERE goal_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [id]);
    return result.rows.map((row) => ({ ...row, deltaCents: safeCents(row.deltaCents) }));
  }
}
