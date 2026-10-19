import { useState } from 'react';
import { Search } from 'lucide-react';
import TransactionList from '../components/TransactionList';
import { formatMoney, monthKey, monthName, recentMonths, sortNewest, totalsFor } from '../lib/finance';
import type { Transaction, TransactionType } from '../types/finance';

type TransactionsPageProps = {
  transactions: readonly Transaction[];
  onDelete: (id: string) => void;
  onEdit: (transaction: Transaction) => void;
  isBusy?: boolean;
};

const PAGE_SIZE = 10;

export default function TransactionsPage({ transactions, onDelete, onEdit, isBusy }: TransactionsPageProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TransactionType | 'all'>('all');
  const [month, setMonth] = useState('all');
  const [page, setPage] = useState(1);

  const availableMonths = [...new Set([...recentMonths(6), ...transactions.map((item) => monthKey(item.date))])].sort().reverse();
  const filtered = sortNewest(transactions.filter((item) => {
    const matchesQuery = `${item.title} ${item.category}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
    return matchesQuery && (type === 'all' || item.type === type) && (month === 'all' || monthKey(item.date) === month);
  }));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totals = totalsFor(filtered);

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
            <input value={query} onChange={(event) => updateFilters(() => setQuery(event.target.value))} placeholder="Поиск по названию и категории" />
          </label>
          <label className="sr-labeled"><span className="sr-only">Тип операции</span>
            <select value={type} onChange={(event) => updateFilters(() => setType(event.target.value as TransactionType | 'all'))}>
              <option value="all">Все типы</option><option value="income">Доходы</option><option value="expense">Расходы</option>
            </select>
          </label>
          <label className="sr-labeled"><span className="sr-only">Месяц операции</span>
            <select value={month} onChange={(event) => updateFilters(() => setMonth(event.target.value))}>
              <option value="all">Все месяцы</option>
              {availableMonths.map((key) => <option value={key} key={key}>{monthName(key)}</option>)}
            </select>
          </label>
        </div>
        <div className="operations-summary">
          <span>Найдено операций: <strong>{filtered.length}</strong></span>
          <span>Доходы: <strong className="positive">{formatMoney(totals.income)}</strong></span>
          <span>Расходы: <strong>{formatMoney(totals.expense)}</strong></span>
        </div>
        <TransactionList transactions={visible} onDelete={onDelete} onEdit={onEdit} isBusy={isBusy} />
        {totalPages > 1 && (
          <div className="pagination">
            <button className="button button--secondary" type="button" disabled={currentPage === 1} onClick={() => setPage((previous) => previous - 1)}>Назад</button>
            <span>Страница {currentPage} из {totalPages}</span>
            <button className="button button--secondary" type="button" disabled={currentPage === totalPages} onClick={() => setPage((previous) => previous + 1)}>Вперёд</button>
          </div>
        )}
      </section>
    </div>
  );
}
