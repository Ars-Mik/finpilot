import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowDownLeft, ArrowUpRight, History, Pencil, PiggyBank, Plus, RotateCw, Target, X } from 'lucide-react';
import { getAccounts, type Account } from '../api/accounts';
import {
  addGoal, archiveGoal, changeGoalReserve, editGoal, getGoalHistory, getGoals,
  type Goal, type GoalAllocation,
} from '../api/goals';
import { ApiError } from '../api/transactions';
import { formatDate, formatMoney, todayLocal } from '../lib/finance';
import './GoalsPage.css';

type Reservation = { id: string; action: 'reserve' | 'release' } | null;

function parseCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [rubles = '', fraction = ''] = normalized.split('.');
  const cents = Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000_000 ? cents : null;
}

function monthsUntil(date: string, today: string): number {
  if (date <= today) return 0;
  const [year, month, day] = date.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  return (year! - todayYear!) * 12 + month! - todayMonth! + (day! > todayDay! ? 1 : 0);
}

function goalError(cause: unknown, conflictMessage: string): string {
  if (cause instanceof ApiError && cause.status === 409) return conflictMessage;
  return cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.';
}

export default function GoalsPage({ revision }: { revision: number }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [target, setTarget] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [reservation, setReservation] = useState<Reservation>(null);
  const [reserveAmount, setReserveAmount] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<GoalAllocation[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getGoals(controller.signal), getAccounts(controller.signal)])
      .then(([nextGoals, nextAccounts]) => {
        if (controller.signal.aborted) return;
        setGoals(nextGoals);
        setAccounts(nextAccounts);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(goalError(cause, 'Не удалось загрузить цели.'));
      });
    return () => controller.abort();
  }, [refresh, revision]);

  async function reload(): Promise<void> {
    const [nextGoals, nextAccounts] = await Promise.all([getGoals(), getAccounts()]);
    setGoals(nextGoals);
    setAccounts(nextAccounts);
  }

  async function mutate(action: () => Promise<unknown>, success: string, conflict: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(goalError(cause, conflict));
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  function clearForm() {
    setEditingId(null);
    setName('');
    setTarget('');
    setDueDate('');
    setAccountId('');
  }

  function startEdit(goal: Goal) {
    setEditingId(goal.id);
    setName(goal.name);
    setTarget(String(goal.targetCents / 100));
    setDueDate(goal.dueDate);
    setAccountId(goal.accountId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseCents(target);
    const selectedAccount = editingId ? accountId : (accountId || accounts[0]?.id);
    if (!name.trim() || !amountCents || !selectedAccount || !dueDate) {
      setError('Заполни название, счёт, сумму и срок цели.');
      return;
    }
    if (!editingId && dueDate < todayLocal()) {
      setError('Укажи срок не раньше сегодняшнего дня.');
      return;
    }
    const input = { name: name.trim(), targetCents: amountCents, dueDate };
    const success = await mutate(
      () => editingId ? editGoal(editingId, input) : addGoal({ ...input, accountId: selectedAccount }),
      editingId ? 'Цель обновлена.' : 'Цель создана.',
      'Сумма цели не может быть меньше уже зарезервированных средств.',
    );
    if (success) clearForm();
  }

  async function allocate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reservation) return;
    const cents = parseCents(reserveAmount);
    if (!cents) { setError('Укажи сумму больше нуля, не более 10 млрд ₽.'); return; }
    const { id, action } = reservation;
    const success = await mutate(
      () => changeGoalReserve(id, action, cents),
      action === 'reserve' ? 'Средства зарезервированы.' : 'Средства возвращены в свободный остаток.',
      action === 'reserve'
        ? 'Не хватает свободных средств на счёте или превышена сумма цели.'
        : 'Нельзя вернуть больше зарезервированной суммы.',
    );
    if (success) {
      setReservation(null);
      setReserveAmount('');
      if (historyId === id) void loadHistory(id);
    }
  }

  async function archive(goal: Goal) {
    if (!window.confirm(`Архивировать цель «${goal.name}»? Весь резерв будет освобождён, но деньги останутся на счёте.`)) return;
    const success = await mutate(() => archiveGoal(goal.id), 'Цель перенесена в архив.', 'Не удалось архивировать цель.');
    if (success && editingId === goal.id) clearForm();
  }

  async function loadHistory(id: string) {
    setHistoryLoading(true);
    setHistory(null);
    try {
      const records = await getGoalHistory(id);
      setHistory(records);
    } catch (cause) {
      setError(goalError(cause, 'Не удалось загрузить историю.'));
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleHistory(id: string) {
    if (historyId === id) { setHistoryId(null); setHistory(null); return; }
    setHistoryId(id);
    void loadHistory(id);
  }

  const activeGoals = goals?.filter((goal) => goal.status === 'active') ?? [];
  const archivedGoals = goals?.filter((goal) => goal.status === 'archived') ?? [];
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const totalReserved = activeGoals.reduce((total, goal) => total + goal.reservedCents, 0);
  const totalTargets = activeGoals.reduce((total, goal) => total + goal.targetCents, 0);
  const today = todayLocal();

  function renderGoal(goal: Goal) {
    const archived = goal.status === 'archived';
    const percent = Math.min(100, Math.round(goal.reservedCents / goal.targetCents * 100));
    const available = goal.accountBalanceCents - goal.accountReservedCents;
    const monthly = monthsUntil(goal.dueDate, today);
    return (
      <article className={`panel goal-card${archived ? ' goal-card--archived' : ''}`} key={goal.id}>
        <div className="goal-card__header">
          <div><span className="goal-card__account">{accountNames.get(goal.accountId) ?? 'Счёт недоступен'}</span><h2>{goal.name}</h2></div>
          <span className={`goal-status${archived ? ' goal-status--archived' : ''}`}>
            {archived ? 'В архиве' : percent === 100 ? 'Сумма собрана' : 'Активна'}
          </span>
        </div>
        <div className="goal-card__amounts">
          <strong>{formatMoney(goal.reservedCents)}</strong>
          <span>из {formatMoney(goal.targetCents)}</span>
        </div>
        <div className="goal-progress" role="progressbar" aria-label={`Прогресс: ${goal.name}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="goal-card__meta"><span>{percent}% накоплено</span><span>До {formatDate(goal.dueDate)}</span></div>
        {!archived && <div className="goal-card__details">
          <div><span>До цели</span><strong>{formatMoney(goal.remainingCents)}</strong></div>
          <div><span>Свободно на счёте</span><strong className={available < 0 ? 'goal-negative' : ''}>{formatMoney(available)}</strong></div>
          <div><span>Нужно откладывать</span><strong>{goal.remainingCents === 0 ? 'Цель достигнута' : monthly > 0 ? `${formatMoney(Math.ceil(goal.remainingCents / monthly))} / мес.` : 'Срок прошёл'}</strong></div>
        </div>}
        {!archived && available < 0 && <p className="goal-warning" role="status">Расходы превысили свободный остаток. Резерв не списывается автоматически — проверь счёт.</p>}
        <div className="goal-card__actions">
          {!archived && <>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => { setReservation({ id: goal.id, action: 'reserve' }); setReserveAmount(''); }}><Plus size={16} /> Пополнить</button>
            <button className="button button--secondary" type="button" disabled={busy || goal.reservedCents <= 0} onClick={() => { setReservation({ id: goal.id, action: 'release' }); setReserveAmount(''); }}><ArrowDownLeft size={16} /> Вернуть</button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => startEdit(goal)}><Pencil size={15} /> Изменить</button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => { void archive(goal); }}><Archive size={15} /> Архив</button>
          </>}
          <button className="button button--secondary" type="button" onClick={() => toggleHistory(goal.id)} aria-expanded={historyId === goal.id}><History size={15} /> История</button>
        </div>
        {reservation?.id === goal.id && !archived && (
          <form className="goal-inline-form" onSubmit={(event) => { void allocate(event); }}>
            <label className="field"><span>{reservation.action === 'reserve' ? 'Зарезервировать, ₽' : 'Вернуть в свободный остаток, ₽'}</span>
              <input autoFocus inputMode="decimal" required value={reserveAmount} onChange={(event) => setReserveAmount(event.target.value)} placeholder="0,00" /></label>
            <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => setReservation(null)}>Отмена</button>
            <small>Баланс счёта не меняется.</small>
          </form>
        )}
        {historyId === goal.id && <div className="goal-history">
          <h3>История резервирований</h3>
          {historyLoading ? <p role="status">Загружаем историю…</p> : history?.length ? (
            <ul>{history.map((item) => <li key={item.id}>
              <span>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</span>
              <strong className={item.deltaCents < 0 ? 'goal-negative' : ''}>{item.deltaCents > 0 ? '+' : '−'}{formatMoney(Math.abs(item.deltaCents))}</strong>
            </li>)}</ul>
          ) : <p>Записей пока нет.</p>}
        </div>}
      </article>
    );
  }

  return <div className="page-stack goals-page">
    <header className="page-heading">
      <div><div className="eyebrow">ФИНАНСОВОЕ ПЛАНИРОВАНИЕ</div><h1>Финансовые цели</h1><p>Резервируй часть средств на счёте без дополнительного расхода.</p></div>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}><RotateCw size={16} /> Обновить</button>
    </header>
    {error && <div className="api-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
    {notice && <div className="goal-notice" role="status">{notice}</div>}
    <section className="goals-overview" aria-label="Сводка финансовых целей">
      <div><span>Активных целей</span><strong>{goals === null ? '—' : activeGoals.length}</strong></div>
      <div><span>Зарезервировано</span><strong>{goals === null ? '—' : formatMoney(totalReserved)}</strong></div>
      <div><span>Целевая сумма</span><strong>{goals === null ? '—' : formatMoney(totalTargets)}</strong></div>
    </section>
    <div className="goals-layout">
      <section className="goals-list" aria-label="Список целей">
        {goals === null ? <div className="data-state" role="status">Загружаем цели…</div>
          : activeGoals.length === 0 ? <div className="panel goal-empty"><Target size={25} /><h2>Пока нет активных целей</h2><p>Создай цель и начни откладывать средства.</p></div>
            : activeGoals.map(renderGoal)}
        {archivedGoals.length > 0 && <div className="goals-archive">
          <button className="button button--secondary" type="button" onClick={() => setShowArchived((value) => !value)} aria-expanded={showArchived}>
            <Archive size={16} /> {showArchived ? 'Скрыть архив' : `Архив (${archivedGoals.length})`}
          </button>
          {showArchived && archivedGoals.map(renderGoal)}
        </div>}
      </section>
      <section className="panel goals-editor" ref={formRef} aria-label={editingId ? 'Редактирование цели' : 'Создание цели'}>
        <div className="panel-heading"><div><h2>{editingId ? 'Изменить цель' : 'Новая цель'}</h2><p>Сумма резервируется отдельно от операций.</p></div><PiggyBank size={21} /></div>
        <form className="goals-form" onSubmit={(event) => { void save(event); }}>
          <label className="field"><span>Название</span><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, отпуск" /></label>
          <label className="field"><span>Счёт</span><select required disabled={Boolean(editingId)} value={accountId || accounts[0]?.id || ''} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></label>
          <label className="field"><span>Сумма цели, ₽</span><input inputMode="decimal" required value={target} onChange={(event) => setTarget(event.target.value)} placeholder="200000" /></label>
          <label className="field"><span>Срок</span><input type="date" required value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <button className="button button--primary" type="submit" disabled={busy || accounts.length === 0}>{busy ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Создать цель'}</button>
          {editingId && <button className="button button--secondary" type="button" onClick={clearForm} disabled={busy}><X size={16} /> Отмена</button>}
          {accounts.length === 0 && <small>Чтобы создать цель, сначала добавь счёт в разделе «Счета».</small>}
        </form>
        <div className="goals-explainer"><ArrowUpRight size={18} />Резерв не меняет баланс. При расходах со счёта свободная сумма может стать отрицательной.</div>
      </section>
    </div>
  </div>;
}
