import type { ForecastSnapshot } from './forecast.schema.js';

export interface ForecastRepository {
  readSnapshot(asOf: string, through: string): Promise<ForecastSnapshot>;
}
