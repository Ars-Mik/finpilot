import type { Transaction, TransactionInput } from '../types/finance';

const API_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const PAGE_LIMIT = 100;

type ApiErrorResponse = { error?: { code?: string; message?: string } };
type ApiItemResponse = { data: Transaction };
type ApiPageResponse = { data: Transaction[]; meta: { page: number; limit: number; total: number } };

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

export async function getTransactions(signal?: AbortSignal): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const result = await request<ApiPageResponse>(`/api/transactions?page=${page}&limit=${PAGE_LIMIT}`, { signal });
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.meta?.total) || result.meta.total < 0) {
      throw new ApiError('API вернул некорректные данные.');
    }
    total = result.meta.total;
    all.push(...result.data);
    if (all.length >= total) break;
    if (result.data.length === 0) throw new ApiError('Не удалось получить все операции из API.');
    page += 1;
  }

  return all;
}

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  const result = await request<ApiItemResponse>('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
  const result = await request<ApiItemResponse>(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function removeTransaction(id: string): Promise<void> {
  await request<void>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
