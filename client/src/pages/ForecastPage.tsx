import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, ChartNoAxesCombined, CircleCheck, RefreshCw, Wallet } from 'lucide-react';
import { simulateForecast, type ForecastChange, type ForecastMonth, type ForecastMonths, type ForecastResult } from '../api/forecast';
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
      <svg viewBox="0 0 780 250" role="img" aria-label="График базового прогноза и виртуальных изменений" preserveAspectRatio="xMidYMid meet">
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
        {showScenario && <span><i className="forecast-legend--scenario" /> Сценарий</span>}</div>
    </div>
  );
}

export default function ForecastPage() {
  const [months, setMonths] = useState<ForecastMonths>(6);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<ForecastChange[]>([]);
  const [title, setTitle] = useState('Крупная покупка');
  const [amount, setAmount] = useState('90000');
  const [date, setDate] = useState('');
  const [type, setType] = useState<ForecastChange['type']>('expense');
  const [frequency, setFrequency] = useState<ForecastChange['frequency']>('once');
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

  async function applyChanges(next: ForecastChange[]): Promise<boolean> {
    if (submitLock.current) return false;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const scenario = next.length ? { kind: 'plan' as const, title: 'Мой сценарий', changes: next } : null;
      const response = await simulateForecast(months, scenario);
      setResult(response);
      setChanges(next);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось рассчитать сценарий.');
      return false;
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  async function addChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result || submitLock.current || changes.length >= 5) return;
    const amountCents = parseAmount(amount);
    if (!amountCents) { setError('Введите сумму больше нуля, не превышающую 10 млрд ₽.'); return; }
    if (date <= result.asOf || date > result.through) {
      setError(`Дата должна быть после ${formatDate(result.asOf)} и не позднее ${formatDate(result.through)}.`);
      return;
    }
    if (!title.trim()) { setError('Введите название изменения.'); return; }
    const change: ForecastChange = { title: title.trim(), amountCents, date, type, frequency };
    if (await applyChanges([...changes, change])) {
      setTitle('');
      setAmount('');
      setDate('');
    }
  }

  function clearScenario() {
    if (submitLock.current) return;
    setChanges([]);
    setResult(null);
    setError(null);
    setRevision((value) => value + 1);
  }

  const showScenario = changes.length > 0 && result?.scenario !== null;
  const last = result?.months[result.months.length - 1];
  const impact = last ? last.scenarioCents - last.baselineCents : 0;

  return (
    <div className="forecast-page">
      <header className="page-heading forecast-heading">
        <div><div className="eyebrow">ФИНАНСОВОЕ ПЛАНИРОВАНИЕ</div><h1>Прогноз и сценарии</h1>
          <p>Сравнивай базовый прогноз с виртуальными доходами и расходами.</p></div>
        <label className="period-control"><span>Горизонт</span><select value={months} disabled={busy} onChange={(event) => {
          setMonths(Number(event.target.value) as ForecastMonths);
          setChanges([]);
          setResult(null);
          setError(null);
        }}><option value={3}>3 месяца</option><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option></select></label>
      </header>

      {error && <div className="api-alert" role="alert">{error}<button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
      {!result ? (!error && <div className="data-state" role="status">Рассчитываем прогноз…</div>) : <>
        <div className="forecast-highlights">
          <div className="forecast-highlight"><span><Wallet size={17} /> Текущий остаток</span><strong>{formatMoney(result.currentBalanceCents)}</strong><small>По всем счетам на {formatDate(result.asOf)}</small></div>
          <div className="forecast-highlight"><span><ChartNoAxesCombined size={17} /> К концу периода</span><strong>{formatMoney(last?.scenarioCents ?? result.currentBalanceCents)}</strong><small>{formatDate(result.through)}{showScenario ? ' · с учётом сценария' : ''}</small></div>
          <div className="forecast-highlight"><span><CalendarDays size={17} /> Плановые события</span><strong>{result.plannedEvents}</strong><small>Реальные будущие операции и регулярные начисления</small></div>
        </div>
        <div className="forecast-layout">
          <section className="panel forecast-plot" aria-label="Финансовый прогноз">
            <div className="panel-heading"><div><h2>Динамика денежных средств</h2><p>Остаток на конец каждого месяца</p></div></div>
            <CompareChart entries={result.months} current={result.currentBalanceCents} showScenario={showScenario} />
            <div className={`forecast-risk ${result.withScenario.firstNegativeDate ? 'forecast-risk--negative' : ''}`}>
              {result.withScenario.firstNegativeDate ? <AlertTriangle size={19} /> : <CircleCheck size={19} />}
              <div><strong>{result.withScenario.firstNegativeDate
                ? `Возможный недостаток средств с ${formatDate(result.withScenario.firstNegativeDate)}`
                : 'Отрицательный остаток не прогнозируется'}</strong>
                <span>Минимальный остаток за период: {formatMoney(result.withScenario.lowestBalanceCents)}</span></div>
            </div>
            <p className="forecast-disclaimer">Сценарии не создают операции и не меняют остатки. Экономия моделирует снижение будущих расходов, а не меняет существующие записи. Колонки доходов и расходов показывают только базовый расчёт. Переводы между своими счетами не изменяют общий остаток.</p>
          </section>
          <section className="panel forecast-scenario" aria-label="Виртуальный сценарий">
            <div className="panel-heading"><div><h2>Что, если?</h2><p>До пяти изменений в одном сценарии</p></div></div>
            <form className="forecast-form" onSubmit={(event) => { void addChange(event); }}>
              <label className="field"><span>Название</span><input value={title} maxLength={80} required onChange={(event) => setTitle(event.target.value)} placeholder="Повышение зарплаты" /></label>
              <label className="field"><span>Тип изменения</span><select value={type} onChange={(event) => setType(event.target.value as ForecastChange['type'])}>
                <option value="expense">Дополнительный расход</option><option value="income">Дополнительный доход</option><option value="saving">Экономия на расходах</option>
              </select></label>
              <label className="field"><span>Периодичность</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as ForecastChange['frequency'])}>
                <option value="once">Один раз</option><option value="monthly">Каждый месяц</option>
              </select></label>
              <label className="field"><span>Сумма, ₽</span><input value={amount} required inputMode="decimal" placeholder="15000" onChange={(event) => setAmount(event.target.value)} /></label>
              <label className="field"><span>{frequency === 'monthly' ? 'Дата первого изменения' : 'Дата'}</span><input type="date" required min={new Date(Date.parse(`${result.asOf}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)} max={result.through} value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <button className="button button--primary" disabled={busy || changes.length >= 5} type="submit"><ArrowRight size={17} /> {busy ? 'Расчёт…' : 'Добавить в сценарий'}</button>
              {showScenario && <button className="button button--secondary" type="button" disabled={busy} onClick={clearScenario}><RefreshCw size={16} /> Сбросить сценарий</button>}
            </form>
            {changes.length > 0 && <div className="forecast-changes" aria-label="Изменения сценария">
              <h3>Добавленные изменения</h3>
              <ul>{changes.map((change, index) => <li key={`${index}-${change.title}`}>
                <div><strong>{change.title}</strong><small>{change.type === 'expense' ? '−' : '+'}{formatMoney(change.amountCents)} · {change.frequency === 'monthly' ? 'ежемесячно с ' : ''}{formatDate(change.date)}</small></div>
                <button type="button" disabled={busy} aria-label={`Убрать ${change.title}`} onClick={() => { void applyChanges(changes.filter((_, i) => i !== index)); }}>Убрать</button>
              </li>)}</ul>
            </div>}
            {showScenario && last && <div className="forecast-impact"><span>Влияние сценария к концу периода</span><strong>{impact > 0 ? '+' : ''}{formatMoney(impact)}</strong><small>В сравнении с базовым прогнозом</small></div>}
          </section>
        </div>
        <section className="panel forecast-table-panel" aria-label="Прогноз по месяцам">
          <div className="panel-heading"><div><h2>Помесячный прогноз</h2><p>Плановые поступления, списания и остатки</p></div></div>
          <div className="forecast-table-wrapper"><table className="forecast-table"><thead><tr><th>Месяц</th><th>Доходы</th><th>Расходы</th><th>Базовый остаток</th>{showScenario && <th>Со сценарием</th>}</tr></thead><tbody>
            {result.months.map((item) => <tr key={item.month}><th scope="row">{monthName(item.month)}</th><td className="forecast-value--positive">+{formatMoney(item.incomeCents)}</td><td>−{formatMoney(item.expenseCents)}</td><td>{formatMoney(item.baselineCents)}</td>{showScenario && <td>{formatMoney(item.scenarioCents)}</td>}</tr>)}
          </tbody></table></div>
        </section>
      </>}
    </div>
  );
}
