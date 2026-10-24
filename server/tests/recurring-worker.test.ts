import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool } from '../src/db/pool.js';
import { PgAccountRepository } from '../src/modules/accounts/pg-account.repository.js';
import { PgRecurringRepository } from '../src/modules/recurring/pg-recurring.repository.js';
import { applyRecurringForGuests, RECURRING_LOCK } from '../src/jobs/recurring.js';
import { createWorkspacePool, inWorkspace } from '../src/security/workspace-db.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.CI === 'true' && !databaseUrl) {
  throw new Error('CI requires INTEGRATION_DATABASE_URL for recurring job tests');
}

describe.skipIf(!databaseUrl)('scheduled recurring (real PostgreSQL)', () => {
  let pool: Pool;
  let accounts: PgAccountRepository;
  let recurring: PgRecurringRepository;

  beforeAll(() => {
    pool = createPool(databaseUrl!);
    const scoped = createWorkspacePool(pool);
    accounts = new PgAccountRepository(scoped);
    recurring = new PgRecurringRepository(scoped);
  });
  afterAll(async () => { await pool?.end(); });

  async function newGuest(expires: boolean) {
    const id = randomUUID();
    await pool.query("INSERT INTO workspaces (id, kind) VALUES ($1, 'guest')", [id]);
    await pool.query(
      `INSERT INTO guest_sessions (token_hash, workspace_id, expires_at)
       VALUES ($1, $2, NOW() + $3::interval)`,
      [randomBytes(32).toString('hex'), id, expires ? '-1 day' : '3 days'],
    );
    const account = await inWorkspace(id, () => accounts.create({
      name: 'Daily expenses', kind: 'checking', openingBalanceCents: 0,
    }));
    return { id, accountId: account.id };
  }

  async function newRule(id: string, accountId: string, startDate: string) {
    return inWorkspace(id, () => recurring.create({
      title: 'Transport', type: 'expense', category: 'Транспорт', amountCents: 15000,
      accountId, frequency: 'weekly', startDate, endDate: null,
    }));
  }

  it('posts active guests only, catches up missed days and is idempotent', async () => {
    const a = await newGuest(false);
    const b = await newGuest(false);
    const expired = await newGuest(true);
    const ruleA = await newRule(a.id, a.accountId, '2026-10-01');
    const ruleB = await newRule(b.id, b.accountId, '2026-10-01');
    const ruleExpired = await newRule(expired.id, expired.accountId, '2026-10-01');
    await inWorkspace(b.id, () => recurring.setEnabled(ruleB.id, false));

    const first = await applyRecurringForGuests(pool, '2026-10-20');
    expect(first.skipped).toBe(false);
    expect(first.failed).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(3);

    const count = async (id: string, ruleId: string) => inWorkspace(id, async () => {
      const scoped = createWorkspacePool(pool);
      const response = await scoped.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM transactions WHERE recurring_rule_id = $1', [ruleId],
      );
      return response.rows[0]!.count;
    });

    expect(await count(a.id, ruleA.id)).toBe(3);
    expect(await count(b.id, ruleB.id)).toBe(0);
    expect(await count(expired.id, ruleExpired.id)).toBe(0);

    const repeated = await applyRecurringForGuests(pool, '2026-10-20');
    expect(repeated.created).toBe(0);
    expect(repeated.failed).toBe(0);
    expect(await count(a.id, ruleA.id)).toBe(3);

    // Restarts catch up the next scheduled occurrence, never future dates.
    await applyRecurringForGuests(pool, '2026-10-23');
    expect(await count(a.id, ruleA.id)).toBe(4);
    expect(await count(b.id, ruleB.id)).toBe(0);
  }, 60000);

  it('skips overlapping scheduler runs', async () => {
    const lock = await pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock($1::int, $2::int)', [...RECURRING_LOCK]);
      const result = await applyRecurringForGuests(pool, '2026-10-20');
      expect(result).toEqual({
        skipped: true, workspaces: 0, created: 0, alreadyRecorded: 0, failed: 0,
      });
    } finally {
      try { await lock.query('SELECT pg_advisory_unlock($1::int, $2::int)', [...RECURRING_LOCK]); }
      finally { lock.release(); }
    }
  });
});
