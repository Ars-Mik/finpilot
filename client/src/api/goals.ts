import { request } from './transactions';

export type GoalStatus = 'active' | 'archived';
export type GoalInput = {
  name: string;
  accountId: string;
  targetCents: number;
  dueDate: string;
};
export type GoalPatch = Pick<GoalInput, 'name' | 'targetCents' | 'dueDate'>;
export type Goal = GoalInput & {
  id: string;
  status: GoalStatus;
  reservedCents: number;
  remainingCents: number;
  accountBalanceCents: number;
  accountReservedCents: number;
};
export type GoalAllocation = {
  id: string;
  goalId: string;
  deltaCents: number;
  createdAt: string;
};

export async function getGoals(signal?: AbortSignal): Promise<Goal[]> {
  const result = await request<{ data: Goal[] }>('/api/goals', { signal });
  if (!Array.isArray(result.data)) throw new Error('Некорректный ответ API целей.');
  return result.data;
}

export async function addGoal(input: GoalInput): Promise<Goal> {
  const result = await request<{ data: Goal }>('/api/goals', {
    method: 'POST', body: JSON.stringify(input),
  });
  return result.data;
}

export async function editGoal(id: string, input: GoalPatch): Promise<Goal> {
  const result = await request<{ data: Goal }>(`/api/goals/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return result.data;
}

export async function changeGoalReserve(id: string, action: 'reserve' | 'release', amountCents: number): Promise<Goal> {
  const result = await request<{ data: Goal }>(`/api/goals/${encodeURIComponent(id)}/allocations`, {
    method: 'POST', body: JSON.stringify({ action, amountCents }),
  });
  return result.data;
}

export async function getGoalHistory(id: string): Promise<GoalAllocation[]> {
  const result = await request<{ data: GoalAllocation[] }>(`/api/goals/${encodeURIComponent(id)}/allocations`);
  if (!Array.isArray(result.data)) throw new Error('Некорректная история цели.');
  return result.data;
}

export async function archiveGoal(id: string): Promise<void> {
  await request<void>(`/api/goals/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}
