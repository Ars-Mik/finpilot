import type { Transaction, TransactionInput } from '../types/finance';

const API_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const RESET_PAGE_LIMIT = 100;

type ApiErrorResponse = { error?: { code?: string; message?: string } };
type ApiItemResponse = { data: Transaction };

export type TransactionFilters = {
  page: number;
  limit: number;
  search?: string;
  type?: 'income' | 'expense';
  month?: string;
};

export type TransactionTotals = { incomeCents: number; expenseCents: number };
export type TransactionPage = {
  data: Transaction[];
  meta: { page: number; limit: number; total: number; totals: TransactionTotals };
};

export type TransactionOverview = {
  total: number;
  balanceCents: number;
  selected: TransactionTotals;
  months: (TransactionTotals & { month: string })[];
  categories: { category: string; amountCents: number }[];
  recent: Transaction[];
};

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Нет соединения с API. Проверь, что backend запущен на порту 3001.');
  }

  if (!response.ok) {
    const body: ApiErrorResponse | null = await response.json().catch(() => null);
    const message = body?.error?.code === 'VALIDATION_ERROR'
      ? 'Данные операции не прошли проверку. Проверь введённые значения.'
      : body?.error?.code === 'NOT_FOUND'
        ? 'Операция не найдена. Обнови список и попробуй ещё раз.'
        : `Ошибка API (${response.status}). ${body?.error?.message ?? 'Повтори попытку позже.'}`;
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getTransactionPage(filters: TransactionFilters, signal?: AbortSignal): Promise<TransactionPage> {
  const params = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.type) params.set('type', filters.type);
  if (filters.month) params.set('month', filters.month);
  const result = await request<TransactionPage>(`/api/transactions?${params}`, { signal });
  if (!Array.isArray(result.data) || !Number.isSafeInteger(result.meta?.total)
    || result.meta.total < 0 || !result.meta.totals
    || !Number.isSafeInteger(result.meta.totals.incomeCents)
    || !Number.isSafeInteger(result.meta.totals.expenseCents)) {
    throw new ApiError('API вернул некорректные данные.');
  }
  return result;
}

export async function getTransactionOverview(month: string, currentMonth: string, signal?: AbortSignal): Promise<TransactionOverview> {
  const params = new URLSearchParams({ month, currentMonth });
  const result = await request<{ data: TransactionOverview }>(`/api/transactions/overview?${params}`, { signal });
  if (!result.data || !Array.isArray(result.data.months) || !Array.isArray(result.data.recent)) {
    throw new ApiError('API вернул некорректную финансовую сводку.');
  }
  return result.data;
}

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  const result = await request<ApiItemResponse>('/api/transactions', { method: 'POST', body: JSON.stringify(input) });
  return result.data;
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
  const result = await request<ApiItemResponse>(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return result.data;
}

export async function removeTransaction(id: string): Promise<void> {
  await request<void>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Use only with a local development database. Demo reset is not atomic.
export async function resetDemoTransactions(data: readonly TransactionInput[]): Promise<void> {
  const all: Transaction[] = [];
  let page = 1;
  for (;;) {
    const current = await getTransactionPage({ page, limit: RESET_PAGE_LIMIT });
    all.push(...current.data);
    if (all.length >= current.meta.total) break;
    if (current.data.length === 0) throw new ApiError('Не удалось загрузить все операции для сброса.');
    page += 1;
  }
  for (const transaction of all) await removeTransaction(transaction.id);
  for (const transaction of data) await createTransaction(transaction);
}
