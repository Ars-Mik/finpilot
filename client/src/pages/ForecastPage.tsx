import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, ChartNoAxesCombined, CircleCheck, RefreshCw, Wallet } from 'lucide-react';
import { simulateForecast, type ForecastMonth, type ForecastMonths, type ForecastResult } from '../api/forecast';
import { formatDate, formatMoney, monthName } from '../lib/finance';

function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 1_000_000_000_000 ? amountCents : null;
}

function CompareChart({ entries, current, showScenario }: { entries: ForecastMonth[]; current: number; showScenario: boolean }) {
  const values = [current, ...entries.flatMap((entry) => showScenario
    ? [entry.baselineCents, entry.scenarioCents] : [entry.baselineCents]), 0];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1, maximum - minimum);
  const left = 55;
  const right = 725;
  const top = 24;
  const bottom = 201;
  const points = (kind: 'baselineCents' | 'scenarioCents') => [current, ...entries.map((entry) => entry[kind])]
    .map((value, index) => {
      const x = left + ((right - left) * index) / entries.length;
      const y = bottom - (bottom - top) * ((value - minimum) / span);
      return { x, y, value };
    });
  const baseline = points('baselineCents');
  const scenario = points('scenarioCents');
  const path = (data: typeof baseline) => data.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const zeroY = bottom - (bottom - top) * ((0 - minimum) / span);

  return (
    <div className="forecast-chart" role="group" aria-label="Сравнение прогнозируемого остатка по месяцам">
      <svg viewBox="0 0 780 250" role="img" aria-label="График базового прогноза и сценария покупки" preserveAspectRatio="xMidYMid meet">
        {[0, 1, 2, 3, 4].map((part) => {
          const y = top + ((bottom - top) * part) / 4;
          const value = maximum - (span * part) / 4;
          return <g key={part}><line x1={left} x2={right} y1={y} y2={y} stroke="var(--chart-grid)" strokeDasharray="4 6" />
            <text x={left - 10} y={y + 4} textAnchor="end" fontSize="10" fill="var(--chart-axis)">{new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100)}</text></g>;
        })}
        <line x1={left} x2={right} y1={zeroY} y2={zeroY} stroke="var(--chart-grid)" strokeWidth="1.25" />
        <path d={path(baseline)} stroke="var(--chart-income)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {showScenario && <path d={path(scenario)} stroke="var(--chart-scenario)" strokeWidth="3.2" strokeDasharray="7 5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {baseline.map(({ x, y }, index) => <circle key={`base-${index}`} cx={x} cy={y} r="4" fill="var(--chart-income)" stroke="var(--surface)" strokeWidth="1.5" />)}
        {showScenario && scenario.map(({ x, y }, index) => <circle key={`scenario-${index}`} cx={x} cy={y} r="3.5" fill="var(--chart-scenario)" stroke="var(--surface)" strokeWidth="1.5" />)}
        {entries.map((entry, index) => <text key={entry.month} x={left + ((right - left) * (index + 1)) / entries.length} y={231} fontSize="10" fill="var(--chart-axis)" textAnchor="middle">{monthName(entry.month, true)}</text>)}
      </svg>
      <div className="forecast-chart__legend"><span><i className="forecast-legend--base" /> Базовый прогноз</span>
        {showScenario && <span><i className="forecast-legend--scenario" /> С учётом покупки</span>}</div>
    </div>
  );
}

export default function ForecastPage() {
  const [months, setMonths] = useState<ForecastMonths>(6);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('Крупная покупка');
  const [amount, setAmount] = useState('90000');
  const [date, setDate] = useState('');
  const [revision, setRevision] = useState(0);
  const submitLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void simulateForecast(months, null, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) { setResult(next); setError(null); }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось получить прогноз.');
      });
    return () => controller.abort();
  }, [months, revision]);

  async function runScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !result) return;
    const amountCents = parseAmount(amount);
    if (!amountCents) { setError('Введите корректную сумму больше нуля, не превышающую 10 млрд ₽.'); return; }
    if (date <= result.asOf || date > result.through) {
      setError(`Дата покупки должна быть с ${formatDate(result.asOf)} по ${formatDate(result.through)} (не включая сегодня).`);
      return;
    }
    if (!title.trim()) { setError('Укажите название покупки.'); return; }
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      setResult(await simulateForecast(months, { title: title.trim(), amountCents, date }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось рассчитать сценарий.');
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  function clearScenario() {
    setResult(null);
    setError(null);
    setRevision((value) => value + 1);
  }

  const activeScenario = result?.scenario;
  const last = result?.months[result.months.length - 1];
  return (
    <div className="forecast-page">
      <header className="page-heading forecast-heading">
        <div><div className="eyebrow">ФИНАНСОВОЕ ПЛАНИРОВАНИЕ</div><h1>Прогноз и сценарии</h1>
          <p>Как изменится остаток с учётом запланированных операций и крупных покупок.</p></div>
        <label className="period-control"><span>Горизонт</span><select value={months} disabled={busy} onChange={(event) => {
          setMonths(Number(event.target.value) as ForecastMonths); setResult(null); setError(null);
        }}><option value={3}>3 месяца</option><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option></select></label>
      </header>

      {error && <div className="api-alert" role="alert">{error}<button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
      {!result ? (!error && <div className="data-state" role="status">Рассчитываем прогноз…</div>) : <>
        <div className="forecast-highlights">
          <div className="forecast-highlight"><span><Wallet size={17} /> Текущий остаток</span><strong>{formatMoney(result.currentBalanceCents)}</strong><small>По всем счетам на {formatDate(result.asOf)}</small></div>
          <div className="forecast-highlight"><span><ChartNoAxesCombined size={17} /> К концу периода</span><strong>{formatMoney(last?.scenarioCents ?? result.currentBalanceCents)}</strong><small>{formatDate(result.through)}{activeScenario ? ' · с учётом покупки' : ''}</small></div>
          <div className="forecast-highlight"><span><CalendarDays size={17} /> Плановые события</span><strong>{result.plannedEvents}</strong><small>Будущие операции и регулярные начисления</small></div>
        </div>
        <div className="forecast-layout">
          <section className="panel forecast-plot" aria-label="Финансовый прогноз">
            <div className="panel-heading"><div><h2>Динамика денежных средств</h2><p>Остаток на конец каждого месяца</p></div></div>
            <CompareChart entries={result.months} current={result.currentBalanceCents} showScenario={Boolean(activeScenario)} />
            <div className={`forecast-risk ${result.withScenario.firstNegativeDate ? 'forecast-risk--negative' : ''}`}>
              {result.withScenario.firstNegativeDate ? <AlertTriangle size={19} /> : <CircleCheck size={19} />}
              <div><strong>{result.withScenario.firstNegativeDate
                ? `Возможный недостаток средств с ${formatDate(result.withScenario.firstNegativeDate)}`
                : 'Отрицательный остаток не прогнозируется'}</strong>
                <span>Минимальный остаток за период: {formatMoney(result.withScenario.lowestBalanceCents)}</span></div>
            </div>
            <p className="forecast-disclaimer">Это расчёт, а не гарантия: незапланированные доходы и расходы в нём не учтены. Переводы между собственными счетами не меняют общий остаток.</p>
          </section>
          <section className="panel forecast-scenario" aria-label="Сценарий покупки">
            <div className="panel-heading"><div><h2>Что, если?</h2><p>Виртуальная покупка, без изменений в базе</p></div></div>
            <form className="forecast-form" onSubmit={(event) => { void runScenario(event); }}>
              <label className="field"><span>Название покупки</span><input value={title} maxLength={80} required onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field"><span>Стоимость, ₽</span><input value={amount} required inputMode="decimal" placeholder="90000" onChange={(event) => setAmount(event.target.value)} /></label>
              <label className="field"><span>Дата покупки</span><input type="date" required min={result.asOf} max={result.through} value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <button className="button button--primary" disabled={busy} type="submit"><ArrowRight size={17} /> {busy ? 'Расчёт…' : 'Рассчитать сценарий'}</button>
              {activeScenario && <button className="button button--secondary" type="button" disabled={busy} onClick={clearScenario}><RefreshCw size={16} /> Без покупки</button>}
            </form>
            {activeScenario && last && <div className="forecast-impact"><span>Влияние покупки на итоговый остаток</span><strong>−{formatMoney(activeScenario.amountCents)}</strong><small>{activeScenario.title} · {formatDate(activeScenario.date)}</small></div>}
          </section>
        </div>
        <section className="panel forecast-table-panel" aria-label="Прогноз по месяцам">
          <div className="panel-heading"><div><h2>Помесячный прогноз</h2><p>Плановые поступления, списания и остатки</p></div></div>
          <div className="forecast-table-wrapper"><table className="forecast-table"><thead><tr><th>Месяц</th><th>Доходы</th><th>Расходы</th><th>Без покупки</th>{activeScenario && <th>С покупкой</th>}</tr></thead><tbody>
            {result.months.map((item) => <tr key={item.month}><th scope="row">{monthName(item.month)}</th><td className="forecast-value--positive">+{formatMoney(item.incomeCents)}</td><td>−{formatMoney(item.expenseCents)}</td><td>{formatMoney(item.baselineCents)}</td>{activeScenario && <td>{formatMoney(item.scenarioCents)}</td>}</tr>)}
          </tbody></table></div>
        </section>
      </>}
    </div>
  );
}
