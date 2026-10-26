import { z } from 'zod';

const cents = z.number().int().positive().max(1_000_000_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value.slice(0, 4) !== '0000' && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export const goalIdSchema = z.uuid();
export const goalCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  accountId: z.uuid(),
  targetCents: cents,
  dueDate: date,
});
export const goalPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  targetCents: cents.optional(),
  dueDate: date.optional(),
}).refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const allocationInputSchema = z.strictObject({
  action: z.enum(['reserve', 'release']),
  amountCents: cents,
});
export type GoalCreate = z.infer<typeof goalCreateSchema>;
export type GoalPatch = z.infer<typeof goalPatchSchema>;
export type AllocationInput = z.infer<typeof allocationInputSchema>;
export type Goal = GoalCreate & {
  id: string; status: 'active' | 'archived'; reservedCents: number; remainingCents: number;
  accountBalanceCents: number; accountReservedCents: number;
};
export type GoalAllocation = { id: string; goalId: string; deltaCents: number; createdAt: string };
