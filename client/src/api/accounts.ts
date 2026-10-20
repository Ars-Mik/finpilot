import { request } from './transactions';

export type AccountKind = 'checking' | 'savings' | 'cash';
export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  openingBalanceCents: number;
  balanceCents: number;
};
export type AccountInput = Pick<Account, 'name' | 'kind' | 'openingBalanceCents'>;
export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: string;
  note: string;
};
export type AccountTransfer = TransferInput & { id: string };

export async function getAccounts(signal?: AbortSignal): Promise<Account[]> {
  const result = await request<{ data: Account[] }>('/api/accounts', { signal });
  if (!Array.isArray(result.data)) throw new Error('Некорректный ответ API счетов.');
  return result.data;
}

export async function addAccount(input: AccountInput): Promise<Account> {
  const result = await request<{ data: Account }>('/api/accounts', { method: 'POST', body: JSON.stringify(input) });
  return result.data;
}

export async function getTransfers(signal?: AbortSignal): Promise<AccountTransfer[]> {
  const result = await request<{ data: AccountTransfer[] }>('/api/transfers?limit=30', { signal });
  if (!Array.isArray(result.data)) throw new Error('Некорректный ответ API переводов.');
  return result.data;
}

export async function addTransfer(input: TransferInput): Promise<AccountTransfer> {
  const result = await request<{ data: AccountTransfer }>('/api/transfers', {
    method: 'POST', body: JSON.stringify(input),
  });
  return result.data;
}
