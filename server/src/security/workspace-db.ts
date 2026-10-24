import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient, QueryResult } from 'pg';

// Every application query runs inside a transaction where PostgreSQL RLS
// can read an immutable, transaction-local workspace identifier.
const workspaceContext = new AsyncLocalStorage<string>();

export function inWorkspace<T>(workspaceId: string, callback: () => T): T {
  return workspaceContext.run(workspaceId, callback);
}

function currentWorkspace(): string {
  const id = workspaceContext.getStore();
  if (!id) throw new Error('Database access denied: missing workspace context');
  return id;
}

async function setWorkspace(client: PoolClient, workspaceId: string): Promise<void> {
  await client.query("SELECT set_config('finpilot.workspace_id', $1, true)", [workspaceId]);
}

// The repositories expect a pg Pool. This façade deliberately supports ONLY
// query() and connect() (the two methods the existing repositories use).
export function createWorkspacePool(pool: Pool): Pool {
  const query = async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    const id = currentWorkspace();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setWorkspace(client, id);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const connect = async (): Promise<PoolClient> => {
    const id = currentWorkspace();
    const client = await pool.connect();
    let started = false;
    let finished = false;
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return async (sql: string, params?: unknown[]): Promise<QueryResult> => {
            if (/^BEGIN\b/i.test(sql.trim())) {
              if (started) throw new Error('Nested workspace transactions are not supported');
              try {
                const result = await target.query(sql, params);
                await setWorkspace(target, id);
                started = true;
                return result;
              } catch (error) {
                await target.query('ROLLBACK').catch(() => undefined);
                throw error;
              }
            }
            if (!started) throw new Error('Workspace transaction must start with BEGIN');
            if (finished) throw new Error('Workspace transaction is already finished');
            const result = await target.query(sql, params);
            if (/^(COMMIT|ROLLBACK)\b/i.test(sql.trim())) finished = true;
            return result;
          };
        }
        if (property === 'release') {
          return () => {
            if (started && !finished) {
              // Never release a connection with an uncommitted transaction.
              void target.query('ROLLBACK').finally(() => target.release());
            } else target.release();
          };
        }
        return Reflect.get(target, property, target);
      },
    });
  };

  return new Proxy(pool, {
    get(target, property) {
      if (property === 'query') return query;
      if (property === 'connect') return connect;
      throw new Error(`Unsupported scoped pool operation: ${String(property)}`);
    },
  });
}
