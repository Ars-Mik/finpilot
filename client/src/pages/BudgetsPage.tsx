import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, RotateCw, Target, Trash2 } from 'lucide-react';
import {
  createBudget, deleteBudget, EXPENSE_CATEGORIES, getBudgetOverview, updateBudgetLimit,
  type Budget, type BudgetOverview, type ExpenseCategory,
} from '../api/budgets';
import { ApiError } from '../api/transactions';
import { formatMoney, monthKey, monthName, todayLocal } from '../lib/finance';

function parseRubles(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [rubles = '', kopecks = ''] = normalized.split('.');
  const cents = Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 1_000_000_000_000 ? cents : null;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return 'На эту категорию уже установлен лимит в выбранном месяце.';
  return cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.';
}

function BudgetCard({ budget, isBusy, onUpdate, onDelete }: {
  budget: Budget;
  isBusy: boolean;
  onUpdate: (id: string, amount: number) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [amount, setAmount] = useState((budget.limitCents / 100).toString());
  const [validation, setValidation] = useState<string | null>(null);
  const percent = Math.round((budget.spentCents / budget.limitCents) * 100);
  const exceeded = budget.remainingCents < 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseRubles(amount);
    if (cents === null) { setValidation('Укажи сумму от 0,01 ₽ до 10 млрд ₽.'); return; }
    setValidation(null);
    const success = await onUpdate(budget.id, cents);
    if (success) setIsEditing(false);
  }

  return (
    <article className={`budget-card${exceeded ? ' budget-card--exceeded' : ''}`}>
      <div className="budget-card__heading">
        <div className="budget-card__title"><span className="budget-card__symbol"><Target size={19} /></span>
          <div><h2>{budget.category}</h2><span>Лимит на месяц</span></div>
        </div>
        <div className="budget-card__actions">
          <button type="button" className="icon-button" title={`Изменить лимит: ${budget.category}`} aria-label={`Изменить лимит: ${budget.category}`} disabled={isBusy} onClick={() => { setAmount((budget.limitCents / 100).toString()); setValidation(null); setIsEditing((previous) => !previous); }}><Pencil size={16} /></button>
          <button type="button" className="icon-button transaction-row__delete" title={`Удалить лимит: ${budget.category}`} aria-label={`Удалить лимит: ${budget.category}`} disabled={isBusy} onClick={() => { void onDelete(budget.id); }}><Trash2 size={16} /></button>
        </div>
      </div>
      {isEditing ? (
        <form className="budget-edit" onSubmit={(event) => { void save(event); }}>
          <label className="field"><span>Новый лимит, ₽</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          {validation && <small role="alert" className="budget-validation">{validation}</small>}
          <div className="budget-edit__actions"><button className="button button--primary" type="submit" disabled={isBusy}>Сохранить</button><button className="button button--secondary" type="button" disabled={isBusy} onClick={() => setIsEditing(false)}>Отмена</button></div>
        </form>
      ) : (
        <>
          <div className="budget-card__numbers"><strong>{formatMoney(budget.spentCents)}</strong><span>из {formatMoney(budget.limitCents)}</span></div>
          <div className={`budget-card__progress${exceeded ? ' budget-card__progress--exceeded' : ''}`} role="progressbar" aria-label={`Использовано бюджета: ${budget.category}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} aria-valuetext={`${percent}% от лимита`}>
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <div className="budget-card__footer">
            <span className={exceeded ? 'budget-card__negative' : 'budget-card__positive'}>
              {exceeded ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              {exceeded ? `Превышение: ${formatMoney(-budget.remainingCents)}` : `Осталось: ${formatMoney(budget.remainingCents)}`}
            </span>
            <span>{percent}%</span>
          </div>
        </>
      )}
    </article>
  );
}

function BudgetsContent({ month, onMonthChange }: { month: string; onMonthChange: (month: string) => void }) {
  const [data, setData] = useState<BudgetOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const busyRef = useRef(false);
  const [category, setCategory] = useState<ExpenseCategory>('Продукты');
  const [limitRubles, setLimitRubles] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getBudgetOverview(month, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [month, retry]);

  async function mutate(action: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      const latest = await getBudgetOverview(month);
      setData(latest);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limitCents = parseRubles(limitRubles);
    if (limitCents === null) { setFormError('Укажи сумму от 0,01 ₽ до 10 млрд ₽.'); return; }
    setFormError(null);
    if (await mutate(() => createBudget({ month, category, limitCents }))) setLimitRubles('');
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Удалить лимит? История расходов останется без изменений.')) return;
    await mutate(() => deleteBudget(id));
  }

  const existingCategories = new Set(data?.budgets.map((budget) => budget.category));
  const unusedCategories = EXPENSE_CATEGORIES.filter((item) => !existingCategories.has(item));
  const chosenCategory = unusedCategories.includes(category) ? category : unusedCategories[0];
  const coveredRemaining = data ? data.totalLimitCents - data.coveredSpentCents : 0;

  return (
    <div className="page-stack">
      <div className="page-heading budget-heading">
        <div><div className="eyebrow">Контроль расходов</div><h1>Бюджеты</h1><p>Установи месячные лимиты и следи за тратами по категориям.</p></div>
        <label className="period-control"><span>Месяц</span><input type="month" min="0001-01" value={month} onChange={(event) => { if (event.target.validity.valid && /^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value.slice(0, 4) !== '0000') onMonthChange(event.target.value); }} /></label>
      </div>
      {error && <div className="api-alert" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(null); setData(null); setRetry((value) => value + 1); }}>Повторить</button></div>}
      {data === null ? (!error && <div className="data-state" role="status">Загружаем бюджеты…</div>) : (
        <>
          <section className="budget-summary" aria-label="Итоги бюджета">
            <div><span>Лимиты на {monthName(month)}</span><strong>{formatMoney(data.totalLimitCents)}</strong></div>
            <div><span>Расходы в пределах категорий с лимитами</span><strong>{formatMoney(data.coveredSpentCents)}</strong></div>
            <div><span>{coveredRemaining >= 0 ? 'Осталось по лимитам' : 'Превышение лимитов'}</span><strong className={coveredRemaining < 0 ? 'budget-summary__negative' : ''}>{formatMoney(Math.abs(coveredRemaining))}</strong></div>
          </section>
          <div className="budget-insights">
            <div><span>Все расходы месяца</span><strong>{formatMoney(data.totalSpentCents)}</strong></div>
            <div><span>Без установленного лимита</span><strong>{formatMoney(data.unbudgetedSpentCents)}</strong></div>
            <div><span>Категорий с превышением</span><strong>{data.overLimitCount}</strong></div>
          </div>
          <div className="budget-grid">
            <section className="panel budget-limits">
              <div className="panel-heading"><div><h2>Лимиты по категориям</h2><p>Расходы со всех счетов за {monthName(month)}.</p></div></div>
              {data.budgets.length === 0 ? <div className="empty-state">Пока нет лимитов. Добавь первый бюджет справа.</div> : (
                <div className="budget-cards">
                  {data.budgets.map((budget) => <BudgetCard key={budget.id} budget={budget} isBusy={busy}
                    onUpdate={(id, limitCents) => mutate(() => updateBudgetLimit(id, limitCents))}
                    onDelete={handleDelete} />)}
                </div>
              )}
            </section>
            <section className="panel budget-create">
              <div className="panel-heading"><div><h2>Добавить лимит</h2><p>Один лимит на категорию в месяц.</p></div><Plus size={21} /></div>
              {unusedCategories.length === 0 ? (
                <div className="budget-all-set"><CheckCircle2 size={23} /><p>Для всех категорий установлены лимиты.</p></div>
              ) : (
                <form className="accounts-form" onSubmit={(event) => { void handleCreate(event); }}>
                  <label className="field"><span>Категория расходов</span><select value={chosenCategory} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>
                    {unusedCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select></label>
                  <label className="field"><span>Лимит, ₽</span><input required inputMode="decimal" placeholder="Например, 15000" value={limitRubles} onChange={(event) => setLimitRubles(event.target.value)} /></label>
                  {formError && <small className="budget-validation" role="alert">{formError}</small>}
                  <button type="submit" className="button button--primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Создать лимит'}</button>
                </form>
              )}
              <div className="budget-hint"><RotateCw size={16} /><span>Суммы пересчитываются автоматически при изменении операций.</span></div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function BudgetsPage({ revision }: { revision: number }) {
  const [month, setMonth] = useState(monthKey(todayLocal()));
  return <BudgetsContent key={`${revision}:${month}`} month={month} onMonthChange={setMonth} />;
}
