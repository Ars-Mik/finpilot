import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { forecastPlanSchema } from './forecast.schema.js';
import { ScenarioLimitError, type SavedScenario, type SavedScenarioInput, type SavedScenarioRepository } from './saved-scenario.repository.js';

type SavedRow = {
  id: string;
  title: string;
  months: 3 | 6 | 12;
  changes: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function mapSaved(row: SavedRow): SavedScenario {
  return {
    id: row.id,
    months: row.months,
    scenario: forecastPlanSchema.parse({ kind: 'plan', title: row.title, changes: row.changes }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const columns = `id, title, months, changes, created_at AS "createdAt", updated_at AS "updatedAt"`;

export class PgSavedScenarioRepository implements SavedScenarioRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<SavedScenario[]> {
    const result = await this.pool.query<SavedRow>(
      `SELECT ${columns} FROM forecast_scenarios ORDER BY updated_at DESC, id`,
    );
    return result.rows.map(mapSaved);
  }

  async find(id: string): Promise<SavedScenario | null> {
    const result = await this.pool.query<SavedRow>(
      `SELECT ${columns} FROM forecast_scenarios WHERE id = $1`, [id],
    );
    return result.rows[0] ? mapSaved(result.rows[0]) : null;
  }

  async create(input: SavedScenarioInput): Promise<SavedScenario> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A workspace-scoped lock makes the 10-scenario limit atomic across API instances.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('finpilot_scenarios'),
           hashtext(current_setting('finpilot.workspace_id')))`);
      const count = await client.query<{ total: number }>(
        'SELECT COUNT(*)::int AS total FROM forecast_scenarios',
      );
      if (count.rows[0]!.total >= 10) throw new ScenarioLimitError('Maximum of 10 saved scenarios');
      const id = randomUUID();
      await client.query(
        `INSERT INTO forecast_scenarios (id, title, months, changes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [id, input.scenario.title, input.months, JSON.stringify(input.scenario.changes)],
      );
      await client.query('COMMIT');
      const saved = await this.find(id);
      if (!saved) throw new Error('Saved scenario not found after creation');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: SavedScenarioInput): Promise<SavedScenario | null> {
    const result = await this.pool.query<SavedRow>(
      `UPDATE forecast_scenarios SET title = $2, months = $3, changes = $4::jsonb,
        updated_at = NOW() WHERE id = $1 RETURNING ${columns}`,
      [id, input.scenario.title, input.months, JSON.stringify(input.scenario.changes)],
    );
    return result.rows[0] ? mapSaved(result.rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM forecast_scenarios WHERE id = $1', [id]);
    return result.rowCount === 1;
  }
}
