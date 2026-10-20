import type { Transaction, TransactionInput, TransactionQuery } from './transaction.schema.js';

export type TransactionTotals = {
  incomeCents: number;
  expenseCents: number;
};

export type TransactionPage = {
  items: Transaction[];
  total: number;
  totals: TransactionTotals;
};

export type MonthlyTotals = TransactionTotals & { month: string };
export type CategoryTotal = { category: string; amountCents: number };

export type TransactionOverview = {
  total: number;
  balanceCents: number;
  selected: TransactionTotals;
  months: MonthlyTotals[];
  categories: CategoryTotal[];
  recent: Transaction[];
};

export interface TransactionRepository {
  list(query: TransactionQuery): Promise<TransactionPage>;
  overview(selectedMonth: string, chartMonths: readonly string[]): Promise<TransactionOverview>;
  findById(id: string): Promise<Transaction | null>;
  create(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<Transaction | null>;
  remove(id: string): Promise<boolean>;
}
