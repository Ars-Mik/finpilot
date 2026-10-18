import type { Transaction } from '../types/finance';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const preciseMoneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amountCents: number): string {
  const formatter = amountCents % 100 === 0 ? moneyFormatter : preciseMoneyFormatter;
  return formatter.format(amountCents / 100);
}

export function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function monthName(key: string, short = false): string {
  const date = new Date(`${key}-01T12:00:00`);
  return new Intl.DateTimeFormat('ru-RU', {
    month: short ? 'short' : 'long',
    ...(short ? {} : { year: 'numeric' }),
  }).format(date);
}

export function recentMonths(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  });
}

export function totalsFor(transactions: readonly Transaction[]) {
  const income = transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : 0), 0);
  const expense = transactions.reduce((sum, item) => sum + (item.type === 'expense' ? item.amountCents : 0), 0);
  return { income, expense, balance: income - expense };
}

export function transactionsInMonth(transactions: readonly Transaction[], month: string): Transaction[] {
  return transactions.filter((item) => monthKey(item.date) === month);
}

export function sortNewest(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export function spendingByCategory(transactions: readonly Transaction[]) {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    amounts.set(transaction.category, (amounts.get(transaction.category) ?? 0) + transaction.amountCents);
  }
  return [...amounts].map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
