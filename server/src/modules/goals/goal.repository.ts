import type { AllocationInput, Goal, GoalAllocation, GoalCreate, GoalPatch } from './goal.schema.js';

export class GoalMissingError extends Error {}
export class GoalConflictError extends Error {}

export interface GoalRepository {
  list(): Promise<Goal[]>;
  create(input: GoalCreate): Promise<Goal>;
  update(id: string, patch: GoalPatch): Promise<Goal | null>;
  allocate(id: string, input: AllocationInput): Promise<Goal>;
  archive(id: string): Promise<boolean>;
  history(id: string): Promise<GoalAllocation[] | null>;
}
