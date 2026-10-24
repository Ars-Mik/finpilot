import type { Pool, QueryResult } from 'pg';
import { PgRecurringRepository } from '../modules/recurring/pg-recurring.repository.js';
import { inWorkspace, createWorkspacePool } from '../security/workspace-db.js';

// One lock for the whole database. Overlapping scheduled runs do no extra work.
export const RECURRING_LOCK = [58311, 1] as const;
const PAGE_SIZE = 100;

export type RecurringJobResult = {
  skipped: boolean;
  workspaces: number;
  created: number;
  alreadyRecorded: number;
  failed: number;
};

export async function applyRecurringForGuests(
  pool: Pool,
  today: string,
  onWorkspaceError: (error: unknown) => void = () => undefined,
): Promise<RecurringJobResult> {
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired', [...RECURRING_LOCK],
    );
    if (!lock.rows[0]?.acquired) {
      return { skipped: true, workspaces: 0, created: 0, alreadyRecorded: 0, failed: 0 };
    }
    locked = true;

    const recurring = new PgRecurringRepository(createWorkspacePool(pool));
    const result: RecurringJobResult = {
      skipped: false, workspaces: 0, created: 0, alreadyRecorded: 0, failed: 0,
    };
    let after: string | null = null;

    for (;;) {
      // Only live guest sessions; the legacy workspace is never processed.
      const page: QueryResult<{ workspaceId: string }> = await pool.query<{ workspaceId: string }>(
        `SELECT s.workspace_id AS "workspaceId"
         FROM guest_sessions s
         JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.expires_at > NOW() AND w.kind = 'guest'
           AND ($1::uuid IS NULL OR s.workspace_id > $1::uuid)
         ORDER BY s.workspace_id
         LIMIT $2`, [after, PAGE_SIZE],
      );
      if (page.rows.length === 0) break;

      for (const row of page.rows) {
        try {
          const applied = await inWorkspace(row.workspaceId, () => recurring.applyDue(today));
          result.workspaces += 1;
          result.created += applied.created;
          result.alreadyRecorded += applied.alreadyRecorded;
        } catch (error) {
          result.failed += 1;
          onWorkspaceError(error);
        }
      }
      after = page.rows[page.rows.length - 1]!.workspaceId;
      if (page.rows.length < PAGE_SIZE) break;
    }
    return result;
  } finally {
    try {
      if (locked) {
        await lockClient.query('SELECT pg_advisory_unlock($1::int, $2::int)', [...RECURRING_LOCK]);
      }
    } finally {
      lockClient.release();
    }
  }
}
