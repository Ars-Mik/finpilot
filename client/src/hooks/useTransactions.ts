import { useEffect, useState } from 'react';
import { createDemoTransactions } from '../data/demoTransactions';
import type { Transaction, TransactionInput } from '../types/finance';

const STORAGE_KEY = 'finpilot.transactions.v1';

function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && item.title.length > 0
    && typeof item.category === 'string'
    && typeof item.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    && (item.type === 'income' || item.type === 'expense')
    && typeof item.amountCents === 'number'
    && Number.isSafeInteger(item.amountCents)
    && item.amountCents > 0;
}

function loadTransactions(): Transaction[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return createDemoTransactions();
    const parsed: unknown = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.every(isTransaction)) return parsed;
  } catch {
    // A disabled or corrupted browser storage should not prevent the app from starting.
  }
  return createDemoTransactions();
}

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch {
      // The current session remains usable even when storage is unavailable.
    }
  }, [transactions]);

  function addTransaction(input: TransactionInput) {
    setTransactions((previous) => [{ id: crypto.randomUUID(), ...input }, ...previous]);
  }

  function deleteTransaction(id: string) {
    setTransactions((previous) => previous.filter((transaction) => transaction.id !== id));
  }

  function resetDemo() {
    setTransactions(createDemoTransactions());
  }

  return { transactions, addTransaction, deleteTransaction, resetDemo };
}
