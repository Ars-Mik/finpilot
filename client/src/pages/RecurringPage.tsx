import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, CheckCircle2, PauseCircle, PlayCircle, RotateCw } from 'lucide-react';
import { getAccounts, type Account } from '../api/accounts';
import { EXPENSE_CATEGORIES } from '../api/budgets';
import {
  addRecurring, applyDueRecurring, getRecurring, toggleRecurring,
  type RecurringFrequency, type RecurringInput, type RecurringRule, type RecurringType,
} from '../api/recurring';
import { formatDate, formatMoney, todayLocal } from '../lib/finance';

const INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Подарки', 'Другое'] as const;
const FREQUENCIES: Record<RecurringFrequency, string> = { weekly: 'Каждую неделю', monthly: 'Каждый месяц' };

function parseCents(value: string): number | null {
  const clean = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole = '0', fraction = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 1_000_000_000_000 ? cents : null;
}

function RecurringContent() {
  const [rules, setRules] = useState<RecurringRule[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<RecurringType>('expense');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getRecurring(todayLocal(), controller.signal), getAccounts(controller.signal)])
      .then(([nextRules, nextAccounts]) => {
        if (controller.signal.aborted) return;
        setRules(nextRules);
        setAccounts(nextAccounts);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Ошибка загрузки данных.');
      });
    return () => controller.abort();
  }, [refreshKey]);

  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      const updated = await getRecurring(todayLocal());
      setRules(updated);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.');
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseCents(amount);
    const selectedAccount = accountId || accounts[0]?.id;
    if (!amountCents) { setError('Укажи сумму от 0,01 ₽ до 10 млрд ₽.'); return; }
    if (!selectedAccount) { setError('Сначала создай финансовый счёт.'); return; }
    if (endDate && endDate < startDate) { setError('Дата окончания должна быть не раньше даты начала.'); return; }

    const input: RecurringInput = {
      title: title.trim(), type, category, amountCents, accountId: selectedAccount,
      frequency, startDate, endDate: endDate || null,
    };
    if (await mutate(() => addRecurring(input))) {
      setTitle('');
      setAmount('');
      setEndDate('');
      setNotice('Правило добавлено. Начисления появятся после отдельного подтверждения.');
    }
  }

  async function changeEnabled(rule: RecurringRule) {
    if (await mutate(() => toggleRecurring(rule.id, !rule.enabled))) {
      setNotice(rule.enabled ? 'Регулярная операция приостановлена.' : 'Регулярная операция возобновлена.');
    }
  }

  async function apply() {
    if (!window.confirm('Записать все наступившие регулярные операции за последние 12 месяцев? Уже записанные начисления не повторятся.')) return;
    await mutate(async () => {
      const result = await applyDueRecurring();
      setNotice(`Добавлено операций: ${result.created}. Уже были записаны: ${result.alreadyRecorded}.`);
    });
  }

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const enabled = rules?.filter((rule) => rule.enabled).length ?? 0;
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  return (
    <div className="recurring-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">ФИНАНСОВОЕ ПЛАНИРОВАНИЕ</div>
          <h1>Регулярные операции</h1>
          <p>Настрой повторяющиеся доходы и расходы. Начисления записываются только после подтверждения.</p>
        </div>
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => setRefreshKey((value) => value + 1)}>
          <RotateCw size={16} /> Обновить
        </button>
      </header>

      {error && <div className="api-alert" role="alert">{error}<button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
      {notice && <div className="recurring-notice" role="status"><CheckCircle2 size={18} /> {notice}</div>}

      <section className="recurring-summary" aria-label="Сводка регулярных операций">
        <div><span>Всего правил</span><strong>{rules?.length ?? '—'}</strong></div>
        <div><span>Активных</span><strong>{rules === null ? '—' : enabled}</strong></div>
        <button className="button button--primary" type="button" disabled={busy || !enabled} onClick={() => { void apply(); }}>
          <CalendarClock size={18} /> Записать наступившие операции
        </button>
      </section>

      <div className="recurring-layout">
        <section className="panel recurring-list" aria-label="Настроенные правила">
          <div className="panel-heading"><div><h2>Расписание</h2><p>Ближайшие три даты для каждого активного правила</p></div></div>
          {rules === null ? <p className="recurring-empty">Загрузка правил…</p>
            : rules.length === 0 ? <p className="recurring-empty">Правил пока нет. Создай первое справа.</p>
              : <div className="recurring-cards">
                {rules.map((rule) => (
                  <article className={`recurring-card${rule.enabled ? '' : ' recurring-card--paused'}`} key={rule.id}>
                    <div className="recurring-card__top">
                      <div><h3>{rule.title}</h3><span>{rule.category} · {accountNames.get(rule.accountId) ?? 'Счёт недоступен'}</span></div>
                      <strong className={rule.type === 'income' ? 'recurring-income' : 'recurring-expense'}>
                        {rule.type === 'income' ? '+' : '−'}{formatMoney(rule.amountCents)}
                      </strong>
                    </div>
                    <div className="recurring-card__details">
                      <span>{FREQUENCIES[rule.frequency]}</span>
                      <span>{rule.enabled ? 'Активно' : 'На паузе'}</span>
                    </div>
                    <div className="recurring-card__dates">
                      {rule.upcoming.length ? rule.upcoming.map((date) => <span key={date}>{formatDate(date)}</span>)
                        : <span>{rule.enabled ? 'Будущих начислений нет' : 'Начисления приостановлены'}</span>}
                    </div>
                    <button type="button" className="button button--secondary" disabled={busy} onClick={() => { void changeEnabled(rule); }}>
                      {rule.enabled ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                      {rule.enabled ? 'Приостановить' : 'Возобновить'}
                    </button>
                  </article>
                ))}
              </div>}
        </section>

        <section className="panel recurring-create" aria-label="Новое правило">
          <div className="panel-heading"><div><h2>Новое расписание</h2><p>Доход или расход по одному счёту</p></div></div>
          <form className="recurring-form" onSubmit={(event) => { void createRule(event); }}>
            <label className="field"><span>Название</span><input maxLength={80} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, аренда квартиры" /></label>
            <div className="form-grid">
              <label className="field"><span>Тип операции</span><select value={type} onChange={(event) => {
                const next = event.target.value as RecurringType;
                setType(next);
                setCategory(next === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
              }}><option value="expense">Расход</option><option value="income">Доход</option></select></label>
              <label className="field"><span>Категория</span><select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option value={item} key={item}>{item}</option>)}
              </select></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>Сумма, ₽</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="15000" /></label>
              <label className="field"><span>Счёт</span><select required value={accountId || accounts[0]?.id || ''} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
              </select></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>Периодичность</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringFrequency)}>
                <option value="monthly">Каждый месяц</option><option value="weekly">Каждую неделю</option>
              </select></label>
              <label className="field"><span>Первая дата</span><input required type="date" min="2000-01-01" max="2099-12-31" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            </div>
            <label className="field"><span>Дата окончания (необязательно)</span><input type="date" min={startDate} max="2099-12-31" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <p className="recurring-hint">Создание расписания не меняет баланс. Накопившиеся начисления за последние 12 месяцев можно записать отдельной кнопкой.</p>
            <button className="button button--primary" type="submit" disabled={busy || accounts.length === 0}>Создать правило</button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default function RecurringPage() { return <RecurringContent />; }
