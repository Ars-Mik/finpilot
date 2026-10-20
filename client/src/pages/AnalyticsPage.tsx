import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, PieChart, Wallet } from 'lucide-react';
import { getAnalytics, type AnalyticsPeriodMonths, type AnalyticsReport } from '../api/analytics';
import { formatMoney, monthName, todayLocal } from '../lib/finance';

type AnalyticsPageProps = { revision: number };
type AnalyticsContentProps = { through: string; months: AnalyticsPeriodMonths; onRetry: () => void };

function Delta({ current, previous }: { current: number; previous: number }) {
  const difference = current - previous;
  if (difference === 0) return <span className="analytics-delta">Без изменений к предыдущему периоду</span>;
  return (
    <span className="analytics-delta">
      {difference > 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
      {formatMoney(Math.abs(difference))} {difference > 0 ? 'больше' : 'меньше'} предыдущего периода
    </span>
  );
}

function AnalyticsContent({ through, months, onRetry }: AnalyticsContentProps) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getAnalytics(through, months, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setReport(result); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить аналитику.');
      });
    return () => controller.abort();
  }, [through, months]);

  if (error) return <div className="api-alert" role="alert"><span>{error}</span><button className="button button--secondary" type="button" onClick={onRetry}>Повторить</button></div>;
  if (!report) return <div className="data-state" role="status">Загружаем аналитику…</div>;

  const maxValue = Math.max(1, ...report.monthly.flatMap((row) => [row.incomeCents, row.expenseCents]));
  const categoryTotal = report.categories.reduce((sum, category) => sum + category.expenseCents, 0);
  const largestExpense = report.categories[0];
  const savings = report.current.incomeCents > 0
    ? Math.round((report.current.netCents / report.current.incomeCents) * 100)
    : null;

  return (
    <div className="analytics-content">
      {report.current.transactions === 0 && (
        <div className="welcome-banner">В выбранном периоде нет операций. Можно выбрать другой диапазон.</div>
      )}
      <div className="analytics-summary">
        <article className="analytics-stat">
          <span><ArrowUpRight size={18} /> Доходы</span>
          <strong>{formatMoney(report.current.incomeCents)}</strong>
          <Delta current={report.current.incomeCents} previous={report.previous.incomeCents} />
        </article>
        <article className="analytics-stat">
          <span><ArrowDownRight size={18} /> Расходы</span>
          <strong>{formatMoney(report.current.expenseCents)}</strong>
          <Delta current={report.current.expenseCents} previous={report.previous.expenseCents} />
        </article>
        <article className="analytics-stat">
          <span><Wallet size={18} /> Разница доходов и расходов</span>
          <strong>{formatMoney(report.current.netCents)}</strong>
          <Delta current={report.current.netCents} previous={report.previous.netCents} />
        </article>
        <article className="analytics-stat">
          <span><BarChart3 size={18} /> Доля сбережений</span>
          <strong>{savings === null ? '—' : `${savings}%`}</strong>
          <small>{report.current.transactions.toLocaleString('ru-RU')} операций в выбранном периоде</small>
        </article>
      </div>

      <section className="panel analytics-panel">
        <div className="panel-heading">
          <div><h2>Динамика по месяцам</h2><p>Доходы и расходы без переводов между своими счетами</p></div>
          <div className="chart-legend">
            <span><i className="legend-dot legend-dot--income" />Доходы</span>
            <span><i className="legend-dot legend-dot--expense" />Расходы</span>
          </div>
        </div>
        <div className="analytics-chart-scroll">
          <div className="analytics-chart" role="img" aria-label={report.monthly.map((row) => `${monthName(row.month)}: доходы ${formatMoney(row.incomeCents)}, расходы ${formatMoney(row.expenseCents)}`).join('; ')}>
            {report.monthly.map((row) => (
              <div className="analytics-chart__month" key={row.month}>
                <div className="analytics-chart__columns">
                  <div className="analytics-chart__bar analytics-chart__bar--income" style={{ height: `${(row.incomeCents / maxValue) * 100}%` }} title={`Доходы: ${formatMoney(row.incomeCents)}`} />
                  <div className="analytics-chart__bar analytics-chart__bar--expense" style={{ height: `${(row.expenseCents / maxValue) * 100}%` }} title={`Расходы: ${formatMoney(row.expenseCents)}`} />
                </div>
                <span>{monthName(row.month, true)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="analytics-grid">
        <section className="panel analytics-panel">
          <div className="panel-heading"><div><h2>Расходы по категориям</h2><p>Распределение за выбранный период</p></div><PieChart size={20} /></div>
          {report.categories.length === 0 ? <div className="empty-state">Расходов нет.</div> : (
            <div className="analytics-category-list">
              {report.categories.map((row) => (
                <div className="analytics-category" key={row.category}>
                  <div className="analytics-category__label">
                    <span>{row.category} <small>· {row.transactions} операций</small></span>
                    <strong>{formatMoney(row.expenseCents)}</strong>
                  </div>
                  <div className="analytics-progress"><span style={{ width: `${categoryTotal > 0 ? (row.expenseCents / categoryTotal) * 100 : 0}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel analytics-panel">
          <div className="panel-heading"><div><h2>Разбивка по счетам</h2><p>Операции по каждому счёту за период</p></div></div>
          {report.accounts.length === 0 ? <div className="empty-state">Операций по счетам нет.</div> : (
            <div className="analytics-account-list">
              {report.accounts.map((row) => (
                <div className="analytics-account" key={row.accountId}>
                  <strong>{row.accountName}</strong>
                  <span>Доходы: {formatMoney(row.incomeCents)}</span>
                  <span>Расходы: {formatMoney(row.expenseCents)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="analytics-insight">
            <CheckCircle2 size={17} />
            <span>{largestExpense ? `Самая затратная категория: ${largestExpense.category} — ${formatMoney(largestExpense.expenseCents)}.` : 'Для анализа категорий добавь расходы.'}</span>
          </div>
        </section>
      </div>
      <section className="panel analytics-panel">
        <div className="panel-heading"><div><h2>Помесячная детализация</h2><p>Точные суммы, использованные для построения графика</p></div></div>
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead><tr><th scope="col">Месяц</th><th scope="col">Доходы</th><th scope="col">Расходы</th><th scope="col">Разница</th><th scope="col">Операций</th></tr></thead>
            <tbody>{report.monthly.map((row) => (
              <tr key={row.month}>
                <th scope="row">{monthName(row.month)}</th>
                <td>{formatMoney(row.incomeCents)}</td>
                <td>{formatMoney(row.expenseCents)}</td>
                <td>{formatMoney(row.netCents)}</td>
                <td>{row.transactions}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <p className="analytics-footnote">Сравнение выполнено с предыдущим периодом той же продолжительности ({monthName(report.previous.from)} — {monthName(report.previous.through)}). Начальные остатки счетов в динамику доходов и расходов не включаются.</p>
    </div>
  );
}

export default function AnalyticsPage({ revision }: AnalyticsPageProps) {
  const [through, setThrough] = useState(todayLocal().slice(0, 7));
  const [months, setMonths] = useState<AnalyticsPeriodMonths>(6);
  const [retry, setRetry] = useState(0);
  return (
    <div className="page-stack">
      <div className="page-heading analytics-heading">
        <div><div className="eyebrow">Отчёты и сравнения</div><h1>Аналитика</h1><p>Динамика финансов, структура расходов и показатели по счетам.</p></div>
        <div className="analytics-filters">
          <label className="period-control"><span>До месяца</span><input type="month" min="1900-01" max="2199-12" value={through} onChange={(event) => setThrough(event.target.value)} /></label>
          <label className="period-control"><span>Период</span><select value={months} onChange={(event) => setMonths(Number(event.target.value) as AnalyticsPeriodMonths)}>
            <option value={3}>3 месяца</option><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option>
          </select></label>
        </div>
      </div>
      { /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(through)
        ? <AnalyticsContent key={`${through}:${months}:${revision}:${retry}`} through={through} months={months} onRetry={() => setRetry((value) => value + 1)} />
        : <div className="api-alert" role="alert">Выбери корректный месяц.</div> }
    </div>
  );
}
