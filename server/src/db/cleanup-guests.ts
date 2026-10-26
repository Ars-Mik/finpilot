import { loadAdminConfig } from '../config.js';
import { createPool } from './pool.js';

// Execute periodically in production as a separate administrative maintenance
// job (e.g. hourly). Never expose this operation as an HTTP endpoint.
const pool = createPool(loadAdminConfig().DATABASE_URL);

try {
  // Rate buckets contain HMACs, not raw IPs. Expired keys are safe to delete.
  const oldBuckets = await pool.query(
    "DELETE FROM guest_session_rate_limits WHERE window_start < NOW() - INTERVAL '2 hours'",
  );
  let removed = 0;
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ workspaceId: string }>(
        `SELECT workspace_id AS "workspaceId" FROM guest_sessions
         WHERE expires_at < NOW() ORDER BY expires_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const id = result.rows[0]?.workspaceId;
      if (!id) { await client.query('COMMIT'); break; }
      // Explicit workspace filters are essential because this connection is
      // privileged for migrations and therefore may bypass RLS.
      for (const table of ['goal_allocations', 'savings_goals', 'transactions', 'account_transfers', 'recurring_rules', 'monthly_budgets', 'accounts']) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [id]);
      }
      await client.query('DELETE FROM guest_sessions WHERE workspace_id = $1', [id]);
      await client.query("DELETE FROM workspaces WHERE id = $1 AND kind = 'guest'", [id]);
      await client.query('COMMIT');
      removed += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(`Expired guest workspaces removed: ${removed}`);
  console.log(`Expired rate-limit buckets removed: ${oldBuckets.rowCount ?? 0}`);
} catch (error) {
  console.error('Guest cleanup failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
