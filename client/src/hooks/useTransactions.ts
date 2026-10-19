import { useCallback, useEffect, useRef, useState } from 'react';
import { createTransaction, getTransactions, removeTransaction } from '../api/transactions';
import { createDemoTransactions } from '../data/demoTransactions';
import type { Transaction, TransactionInput } from '../types/finance';

const RESET_BATCH_SIZE = 5;

async function inBatches<T>(items: readonly T[], operation: (item: T) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < items.length; start += RESET_BATCH_SIZE) {
    await Promise.all(items.slice(start, start + RESET_BATCH_SIZE).map(operation));
  }
}

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await getTransactions(signal);
      if (!signal?.aborted) setTransactions(items);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить операции.');
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  
useEffect(() => {
  const controller = new AbortController();

  void getTransactions(controller.signal)
    .then((items) => {
      if (!controller.signal.aborted) {
        setTransactions(items);
      }
    })
    .catch((cause: unknown) => {
      if (controller.signal.aborted) return;

      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось загрузить операции.',
      );
    })
    .finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });

  return () => controller.abort();
}, []);


  async function mutate(operation: () => Promise<void>): Promise<void> {
    if (busyRef.current) throw new Error('Дождись завершения предыдущей операции.');
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.';
      setError(message);
      throw cause;
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }

  async function addTransaction(input: TransactionInput): Promise<void> {
    await mutate(async () => {
      const created = await createTransaction(input);
      setTransactions((previous) => [created, ...previous]);
    });
  }

  async function deleteTransaction(id: string): Promise<void> {
    await mutate(async () => {
      await removeTransaction(id);
      setTransactions((previous) => previous.filter((transaction) => transaction.id !== id));
    });
  }

  async function resetDemo(): Promise<void> {
    await mutate(async () => {
      try {
        // Only for local development. Not an atomic operation; reload even if it fails midway.
        const existing = await getTransactions();
        await inBatches(existing, (transaction) => removeTransaction(transaction.id));
        const demo = createDemoTransactions().map((transaction) => ({
          title: transaction.title, type: transaction.type, category: transaction.category,
          amountCents: transaction.amountCents, date: transaction.date,
        }));
        await inBatches(demo, (input) => createTransaction(input));
      } finally {
        // The database is the source of truth, including after a partially completed reset.
        const items = await getTransactions();
        setTransactions(items);
      }
    });
  }

  return {
    transactions,
    isLoading,
    isBusy,
    error,
    refresh,
    clearError: () => setError(null),
    addTransaction,
    deleteTransaction,
    resetDemo,
  };
}
