import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadAdminConfig } from '../config.js';
import { createPool } from './pool.js';
import { checksumForMigration, matchesMigrationChecksum } from './migration-checksum.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');
const config = loadAdminConfig();
const pool = createPool(config.DATABASE_URL);

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('finpilot_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const filenames = (await readdir(migrationsDir)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const filename of filenames) {
      const sql = await readFile(join(migrationsDir, filename), 'utf8');
      const checksum = checksumForMigration(sql);
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1', [filename],
      );
      if (existing.rows[0]) {
        if (!matchesMigrationChecksum(sql, existing.rows[0].checksum)) {
          throw new Error(`Migration ${filename} changed after being applied`);
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
      console.log(`Applied migration: ${filename}`);
    }
    // Provision a restricted runtime role AFTER all schema changes, within the
    // same migration transaction. The runtime role must never own any tables.
    const appUrl = new URL(config.APP_DATABASE_URL);
    const role = decodeURIComponent(appUrl.username);
    const password = decodeURIComponent(appUrl.password);
    if (!role || !password || role === new URL(config.DATABASE_URL).username) {
      throw new Error('APP_DATABASE_URL must contain a non-admin role and password');
    }
    const exists = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists', [role],
    );
    const template = exists.rows[0]?.exists ? 'ALTER ROLE %I WITH LOGIN PASSWORD %L' : 'CREATE ROLE %I LOGIN PASSWORD %L';
    const formatted = await client.query<{ sql: string }>(
      'SELECT format($1::text, $2::text, $3::text) AS sql', [template, role, password],
    );
    await client.query(formatted.rows[0]!.sql);
    // These names are hard-coded: never grant schema ownership or BYPASSRLS.
    const roleIdent = (await client.query<{ quoted: string }>(
      "SELECT format('%I', $1::text) AS quoted", [role],
    )).rows[0]!.quoted;
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON
      accounts, transactions, account_transfers, monthly_budgets, recurring_rules, savings_goals, forecast_scenarios TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT, DELETE ON goal_allocations TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT ON workspaces, guest_sessions TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON guest_session_rate_limits TO ${roleIdent}`);
    const permission = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [role],
    );
    if (!permission.rows[0] || permission.rows[0].rolsuper || permission.rows[0].rolbypassrls) {
      throw new Error('Runtime role must not be a PostgreSQL superuser or BYPASSRLS');
    }
    await client.query('COMMIT');
    console.log('Database migrations are up to date.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
