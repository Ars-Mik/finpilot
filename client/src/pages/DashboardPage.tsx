import { useEffect, useState } from 'react';
import { getTransactionOverview, type TransactionOverview } from '../api/transactions';
import { ArrowRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import BalanceCard from '../components/BalanceCard';
import TransactionList from '../components/TransactionList';
import { formatMoney, monthName, recentMonths } from '../lib/finance';

type DashboardPageProps = { revision: number };
type DashboardContentProps = { selectedMonth: string; setSelectedMonth: (month: string) => void; chartMonths: string[] };

function DashboardContent({ selectedMonth, setSelectedMonth, chartMonths }: DashboardContentProps) {
  const [overview, setOverview] = useState<TransactionOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getTransactionOverview(selectedMonth, chartMonths[chartMonths.length - 1], controller.signal)
      .then((result) => { if (!controller.signal.aborted) setOverview(result); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить обзор.');
      });
    return () => controller.abort();
  }, [selectedMonth, chartMonths]);

  if (error) return <div className="api-alert" role="alert">{error}</div>;
  if (!overview) return <div className="data-state" role="status">Загружаем финансовую сводку…</div>;

  const currentTotals = {
    income: overview.selected.incomeCents,
    expense: overview.selected.expenseCents,
    balance: overview.selected.incomeCents - overview.selected.expenseCents,
  };
  const topCategories = overview.categories;
  const months = overview.months.map((entry) => ({ month: entry.month, income: entry.incomeCents, expense: entry.expenseCents }));
  const chartMax = Math.max(1, ...months.flatMap(({ income, expense }) => [income, expense]));
  const savingsPercent = currentTotals.income > 0
    ? Math.round((currentTotals.balance / currentTotals.income) * 100)
    : null;

  return (
    <div className="page-stack">
      {overview.total === 0 && <div className="welcome-banner"><strong>Операций пока нет. Добавь первую запись.</strong></div>}
      <div className="page-heading">
        <div>
          <div className="eyebrow">Сводка</div>
          <h1>Обзор финансов</h1>
          <p>Остатки, операции и движение средств.</p>
        </div>
        <label className="period-control">
          <span>Период</span>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {chartMonths.toReversed().map((month) => <option value={month} key={month}>{monthName(month)}</option>)}
          </select>
        </label>
      </div>

      <BalanceCard balanceCents={overview.balanceCents} monthBalanceCents={currentTotals.balance} periodLabel={monthName(selectedMonth)} />

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
        <TransactionList transactions={overview.recent} />
      </section>
    </div>
  );
}

export default function DashboardPage({ revision }: DashboardPageProps) {
  const chartMonths = recentMonths(6);
  const [selectedMonth, setSelectedMonth] = useState(chartMonths[chartMonths.length - 1]);
  return <DashboardContent key={`${selectedMonth}:${revision}`} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} chartMonths={chartMonths} />;
}
