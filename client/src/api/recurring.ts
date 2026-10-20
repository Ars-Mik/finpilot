import { request } from './transactions';

export type RecurringType = 'income' | 'expense';
export type RecurringFrequency = 'weekly' | 'monthly';

export type RecurringInput = {
  title: string;
  type: RecurringType;
  category: string;
  amountCents: number;
  accountId: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
};

export type RecurringRule = RecurringInput & {
  id: string;
  enabled: boolean;
  upcoming: string[];
};

export type ApplyResult = { created: number; alreadyRecorded: number };

export async function getRecurring(on: string, signal?: AbortSignal): Promise<RecurringRule[]> {
  const response = await request<{ data: RecurringRule[] }>(`/api/recurring?${new URLSearchParams({ on })}`, { signal });
  if (!Array.isArray(response.data)) throw new Error('Некорректный ответ API регулярных операций.');
  return response.data;
}

export async function addRecurring(input: RecurringInput): Promise<void> {
  await request('/api/recurring', { method: 'POST', body: JSON.stringify(input) });
}

export async function toggleRecurring(id: string, enabled: boolean): Promise<void> {
  await request<void>(`/api/recurring/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ enabled }),
  });
}

export async function applyDueRecurring(): Promise<ApplyResult> {
  const response = await request<{ data: ApplyResult }>('/api/recurring/apply', {
    method: 'POST', body: JSON.stringify({}),
  });
  if (!Number.isSafeInteger(response.data?.created) || !Number.isSafeInteger(response.data?.alreadyRecorded)) {
    throw new Error('Некорректный результат начисления регулярных операций.');
  }
  return response.data;
}
