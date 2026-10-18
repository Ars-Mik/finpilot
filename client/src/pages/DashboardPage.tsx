import { useState } from 'react';
import { ArrowRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import BalanceCard from '../components/BalanceCard';
import TransactionList from '../components/TransactionList';
import { formatMoney, monthName, recentMonths, sortNewest, spendingByCategory, totalsFor, transactionsInMonth } from '../lib/finance';
import type { Transaction } from '../types/finance';

type DashboardPageProps = { transactions: readonly Transaction[] };

const chartMonths = recentMonths(6);

export default function DashboardPage({ transactions }: DashboardPageProps) {
  const [selectedMonth, setSelectedMonth] = useState(chartMonths[chartMonths.length - 1]);
  const periodTransactions = transactionsInMonth(transactions, selectedMonth);
  const currentTotals = totalsFor(periodTransactions);
  const overallTotals = totalsFor(transactions);
  const topCategories = spendingByCategory(periodTransactions).slice(0, 4);
  const months = chartMonths.map((month) => ({ month, ...totalsFor(transactionsInMonth(transactions, month)) }));
  const chartMax = Math.max(1, ...months.flatMap(({ income, expense }) => [income, expense]));
  const savingsPercent = currentTotals.income > 0
    ? Math.round((currentTotals.balance / currentTotals.income) * 100)
    : null;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Твои финансы под контролем</div>
          <h1>Обзор финансов</h1>
          <p>Все важные показатели в одном месте.</p>
        </div>
        <label className="period-control">
          <span>Период</span>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {chartMonths.toReversed().map((month) => <option value={month} key={month}>{monthName(month)}</option>)}
          </select>
        </label>
      </div>

      <BalanceCard balanceCents={overallTotals.balance} monthBalanceCents={currentTotals.balance} periodLabel={monthName(selectedMonth)} />

      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--income"><TrendingUp size={21} /></span>
          <span className="summary-card__label">Доходы за месяц</span>
          <strong>{formatMoney(currentTotals.income)}</strong>
          <span className="summary-card__caption">Все поступления за выбранный период</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--expense"><TrendingDown size={21} /></span>
          <span className="summary-card__label">Расходы за месяц</span>
          <strong>{formatMoney(currentTotals.expense)}</strong>
          <span className="summary-card__caption">Потрачено за выбранный период</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--savings"><Wallet size={21} /></span>
          <span className="summary-card__label">Доля сбережений</span>
          <strong>{savingsPercent === null ? '—' : `${savingsPercent}%`}</strong>
          <span className="summary-card__caption">Разница доходов и расходов</span>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Динамика финансов</h2><p>Доходы и расходы за последние 6 месяцев</p></div>
            <div className="chart-legend"><span><i className="legend-dot legend-dot--income" />Доходы</span><span><i className="legend-dot legend-dot--expense" />Расходы</span></div>
          </div>
          <div className="bar-chart" role="img" aria-label={months.map(({ month, income, expense }) => `${monthName(month)}: доход ${formatMoney(income)}, расход ${formatMoney(expense)}`).join('; ')}>
            {months.map(({ month, income, expense }) => (
              <div className="bar-chart__column" key={month}>
                <div className="bar-chart__bars">
                  <div className="bar-chart__bar bar-chart__bar--income" style={{ height: `${(income / chartMax) * 100}%` }} />
                  <div className="bar-chart__bar bar-chart__bar--expense" style={{ height: `${(expense / chartMax) * 100}%` }} />
                </div>
                <span>{monthName(month, true)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel categories-panel">
          <div className="panel-heading"><div><h2>Категории расходов</h2><p>За {monthName(selectedMonth)}</p></div></div>
          {topCategories.length === 0 ? (
            <div className="empty-state">В этом месяце расходов пока нет.</div>
          ) : (
            <div className="category-list">
              {topCategories.map(({ category, amountCents }) => (
                <div className="category-item" key={category}>
                  <div className="category-item__line"><span>{category}</span><strong>{formatMoney(amountCents)}</strong></div>
                  <div className="progress-track"><div style={{ width: `${(amountCents / currentTotals.expense) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <div><h2>Последние операции</h2><p>Недавняя активность по счетам</p></div>
          <Link className="text-link" to="/transactions">Все операции <ArrowRight size={16} /></Link>
        </div>
        <TransactionList transactions={sortNewest(transactions).slice(0, 5)} />
      </section>
    </div>
  );
}
