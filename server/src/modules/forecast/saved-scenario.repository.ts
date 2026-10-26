import type { ForecastRequest } from './forecast.schema.js';

type Plan = Extract<NonNullable<ForecastRequest['scenario']>, { kind: 'plan' }>;

export type SavedScenarioInput = { months: ForecastRequest['months']; scenario: Plan };

export type SavedScenario = SavedScenarioInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export class ScenarioLimitError extends Error {}

export interface SavedScenarioRepository {
  list(): Promise<SavedScenario[]>;
  find(id: string): Promise<SavedScenario | null>;
  create(input: SavedScenarioInput): Promise<SavedScenario>;
  update(id: string, input: SavedScenarioInput): Promise<SavedScenario | null>;
  remove(id: string): Promise<boolean>;
}
