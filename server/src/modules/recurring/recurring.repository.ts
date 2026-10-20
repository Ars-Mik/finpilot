import type { ApplyResult, RecurringInput, RecurringWithPreview } from './recurring.schema.js';

export interface RecurringRepository {
  list(on: string): Promise<RecurringWithPreview[]>;
  create(input: RecurringInput): Promise<{ id: string }>;
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  applyDue(today: string): Promise<ApplyResult>;
}
