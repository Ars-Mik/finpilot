export type TransactionType = 'income' | 'expense';

export type Transaction = {
  id: string;
  title: string;
  amountCents: number;
  type: TransactionType;
  category: string;
  date: string;
};

export type TransactionInput = Omit<Transaction, 'id'>;

export const CATEGORIES: Record<TransactionType, readonly string[]> = {
  income: ['Зарплата', 'Подработка', 'Подарки', 'Другое'],
  expense: ['Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Покупки', 'Досуг', 'Другое'],
};
