import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getTransactionPage, type TransactionFilters, type TransactionPage } from '../api/transactions';
import TransactionList from '../components/TransactionList';
import { formatMoney, monthName, recentMonths } from '../lib/finance';
import type { Transaction, TransactionType } from '../types/finance';

type TransactionsPageProps = {
  revision: number;
  onDelete: (id: string) => void;
  onEdit: (transaction: Transaction) => void;
  isBusy?: boolean;
};

const PAGE_SIZE = 10;

type ResultProps = Omit<TransactionsPageProps, 'revision'> & {
  filters: TransactionFilters;
  onPageChange: (page: number) => void;
};

function TransactionsResults({ filters, onPageChange, onDelete, onEdit, isBusy }: ResultProps) {
  const [result, setResult] = useState<TransactionPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getTransactionPage(filters, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(page.meta.total / PAGE_SIZE));
        if (filters.page > lastPage) {
          onPageChange(lastPage);
          return;
        }
        setResult(page);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить операции.');
      });
    return () => controller.abort();
  }, [filters, onPageChange]);

  if (error) return <div className="api-alert" role="alert">{error}</div>;
  if (!result) return <div className="data-state" role="status">Загружаем операции…</div>;

  const totalPages = Math.max(1, Math.ceil(result.meta.total / PAGE_SIZE));
  return (
    <>
      <div className="operations-summary">
        <span>Найдено операций: <strong>{result.meta.total}</strong></span>
        <span>Доходы: <strong className="positive">{formatMoney(result.meta.totals.incomeCents)}</strong></span>
        <span>Расходы: <strong>{formatMoney(result.meta.totals.expenseCents)}</strong></span>
      </div>
      <TransactionList transactions={result.data} onDelete={onDelete} onEdit={onEdit} isBusy={isBusy} />
      {totalPages > 1 && (
        <nav className="pagination" aria-label="Страницы операций">
          <button className="button button--secondary" type="button" disabled={filters.page === 1} onClick={() => onPageChange(filters.page - 1)}>Назад</button>
          <span>Страница {filters.page} из {totalPages}</span>
          <button className="button button--secondary" type="button" disabled={filters.page === totalPages} onClick={() => onPageChange(filters.page + 1)}>Вперёд</button>
        </nav>
      )}
    </>
  );
}

export default function TransactionsPage({ revision, onDelete, onEdit, isBusy }: TransactionsPageProps) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TransactionType | 'all'>('all');
  const [month, setMonth] = useState('all');
  const [page, setPage] = useState(1);
  const months = recentMonths(24).toReversed();

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const filters = useMemo<TransactionFilters>(() => ({
    page,
    limit: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(type !== 'all' ? { type } : {}),
    ...(month !== 'all' ? { month } : {}),
  }), [page, search, type, month]);

  function updateFilters(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><div className="eyebrow">История финансов</div><h1>Операции</h1><p>Все поступления и расходы с удобной фильтрацией.</p></div></div>
      <section className="panel operations-panel">
        <div className="filter-bar">
          <label className="search-input">
            <Search size={19} aria-hidden="true" />
            <span className="sr-only">Поиск операций</span>
            <input value={query} maxLength={100} onChange={(event) => updateFilters(() => setQuery(event.target.value))} placeholder="Поиск по названию и категории" />
          </label>
          <label className="sr-labeled"><span className="sr-only">Тип операции</span>
            <select value={type} onChange={(event) => updateFilters(() => setType(event.target.value as TransactionType | 'all'))}>
              <option value="all">Все типы</option><option value="income">Доходы</option><option value="expense">Расходы</option>
            </select>
          </label>
          <label className="sr-labeled"><span className="sr-only">Месяц операции</span>
            <select value={month} onChange={(event) => updateFilters(() => setMonth(event.target.value))}>
              <option value="all">Все месяцы</option>
              {months.map((key) => <option value={key} key={key}>{monthName(key)}</option>)}
            </select>
          </label>
        </div>
        <TransactionsResults
          key={`${revision}:${page}:${search}:${type}:${month}`}
          filters={filters}
          onPageChange={setPage}
          onDelete={onDelete}
          onEdit={onEdit}
          isBusy={isBusy}
        />
      </section>
    </div>
  );
}
