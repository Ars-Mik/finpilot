import type { Transaction, TransactionInput, TransactionQuery } from './transaction.schema.js';

export type TransactionPage = {
  items: Transaction[];
  total: number;
};

export interface TransactionRepository {
  list(query: TransactionQuery): Promise<TransactionPage>;
  findById(id: string): Promise<Transaction | null>;
  create(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<Transaction | null>;
  remove(id: string): Promise<boolean>;
}
