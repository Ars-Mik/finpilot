import { ApiError, request } from './transactions';

export const EXPENSE_CATEGORIES = ['Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Покупки', 'Досуг', 'Другое'] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export type Budget = {
  id: string;
  month: string;
  category: ExpenseCategory;
  limitCents: number;
  spentCents: number;
  remainingCents: number;
};

export type BudgetOverview = {
  month: string;
  budgets: Budget[];
  totalLimitCents: number;
  coveredSpentCents: number;
  totalSpentCents: number;
  unbudgetedSpentCents: number;
  overLimitCount: number;
};

export type BudgetInput = Pick<Budget, 'month' | 'category' | 'limitCents'>;

export async function getBudgetOverview(month: string, signal?: AbortSignal): Promise<BudgetOverview> {
  const result = await request<{ data: BudgetOverview }>(
    `/api/budgets?${new URLSearchParams({ month })}`,
    { signal },
  );
  const data = result.data;
  if (!data || !Array.isArray(data.budgets) || !Number.isSafeInteger(data.totalSpentCents)
    || !Number.isSafeInteger(data.totalLimitCents) || !Number.isSafeInteger(data.coveredSpentCents)
    || !Number.isSafeInteger(data.unbudgetedSpentCents) || !Number.isSafeInteger(data.overLimitCount)) {
    throw new ApiError('API вернул некорректную сводку по бюджетам.');
  }
  return data;
}

export async function createBudget(input: BudgetInput): Promise<void> {
  await request('/api/budgets', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateBudgetLimit(id: string, limitCents: number): Promise<void> {
  await request<void>(`/api/budgets/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ limitCents }),
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await request<void>(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
