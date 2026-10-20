import type { BudgetInput, BudgetPatch, BudgetOverview } from './budget.schema.js';

export class DuplicateBudgetError extends Error {}

export interface BudgetRepository {
  overview(month: string): Promise<BudgetOverview>;
  create(input: BudgetInput): Promise<{ id: string } & BudgetInput>;
  update(id: string, patch: BudgetPatch): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}
