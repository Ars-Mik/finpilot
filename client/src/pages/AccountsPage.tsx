import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Banknote, Landmark, PiggyBank, Wallet } from 'lucide-react';
import { addAccount, addTransfer, getAccounts, getTransfers, type Account, type AccountKind, type AccountTransfer } from '../api/accounts';
import { formatDate, formatMoney, todayLocal } from '../lib/finance';

const ACCOUNT_KINDS: Record<AccountKind, string> = {
  checking: 'Банковский', savings: 'Накопительный', cash: 'Наличные',
};

function parseAmountCents(value: string, allowZero = false): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [rubles = '', fraction = ''] = normalized.split('.');
  const cents = Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000_000 && (allowZero || cents > 0) ? cents : null;
}

function AccountsContent() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('checking');
  const [openingBalance, setOpeningBalance] = useState('0');

  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayLocal());

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getAccounts(controller.signal), getTransfers(controller.signal)])
      .then(([nextAccounts, nextTransfers]) => {
        if (controller.signal.aborted) return;
        setAccounts(nextAccounts);
        setTransfers(nextTransfers);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить счета.');
      });
    return () => controller.abort();
  }, []);

  async function refresh() {
    const [nextAccounts, nextTransfers] = await Promise.all([getAccounts(), getTransfers()]);
    setAccounts(nextAccounts);
    setTransfers(nextTransfers);
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cents = parseAmountCents(openingBalance, true);
    if (cents === null) { setError('Укажи корректный начальный остаток.'); return; }
    setBusy(true);
    setError(null);
    try {
      await addAccount({ name: name.trim(), kind, openingBalanceCents: cents });
      setName('');
      setOpeningBalance('0');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать счёт.');
    } finally {
      setBusy(false);
    }
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fromAccountId = source || accounts?.[0]?.id;
    const toAccountId = destination || accounts?.find((account) => account.id !== fromAccountId)?.id;
    const amountCents = parseAmountCents(amount);
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      setError('Выбери два разных счёта.'); return;
    }
    if (amountCents === null) { setError('Укажи корректную сумму перевода.'); return; }
    setBusy(true);
    setError(null);
    try {
      await addTransfer({ fromAccountId, toAccountId, amountCents, date, note: note.trim() });
      setAmount('');
      setNote('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить перевод.');
    } finally {
      setBusy(false);
    }
  }

  if (accounts === null && !error) return <div className="data-state" role="status">Загружаем счета…</div>;

  const lookup = new Map(accounts?.map((account) => [account.id, account.name]));
  const fromAccountId = source || accounts?.[0]?.id || '';
  const toAccountId = destination || accounts?.find((account) => account.id !== fromAccountId)?.id || '';
  const balance = accounts?.reduce((sum, account) => sum + account.balanceCents, 0) ?? 0;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><div className="eyebrow">Управление деньгами</div><h1>Счета</h1><p>Карты, накопления и наличные в одном месте.</p></div>
      </div>
      {error && <div className="api-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
      <section className="accounts-total">
        <span>Общий остаток по счетам</span><strong>{formatMoney(balance)}</strong>
        <small>В рублях. Переводы между счетами не меняют общий остаток.</small>
      </section>
      <section className="accounts-grid" aria-label="Финансовые счета">
        {accounts?.map((account) => {
          const Icon = account.kind === 'cash' ? Banknote : account.kind === 'savings' ? PiggyBank : Landmark;
          return (
            <article className="account-card" key={account.id}>
              <div className="account-card__top"><span className="account-card__icon"><Icon size={22} /></span><span className="account-card__kind">{ACCOUNT_KINDS[account.kind]}</span></div>
              <h2>{account.name}</h2>
              <strong>{formatMoney(account.balanceCents)}</strong>
              <small>Начальный остаток: {formatMoney(account.openingBalanceCents)}</small>
            </article>
          );
        })}
      </section>
      <div className="accounts-workspace">
        <section className="panel account-form-panel">
          <div className="panel-heading"><div><h2>Новый счёт</h2><p>Добавь карту, копилку или наличные.</p></div><Wallet size={21} /></div>
          <form className="accounts-form" onSubmit={(event) => { void createAccount(event); }}>
            <label className="field"><span>Название</span><input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Основная карта" /></label>
            <label className="field"><span>Тип счёта</span><select value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
              {Object.entries(ACCOUNT_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="field"><span>Начальный остаток, ₽</span><input inputMode="decimal" required value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
            <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Добавить счёт'}</button>
          </form>
        </section>
        <section className="panel account-form-panel">
          <div className="panel-heading"><div><h2>Перевод</h2><p>Перемещение средств между счетами.</p></div><ArrowLeftRight size={21} /></div>
          <form className="accounts-form" onSubmit={(event) => { void createTransfer(event); }}>
            <label className="field"><span>Со счёта</span><select required value={fromAccountId} onChange={(event) => { setSource(event.target.value); setDestination(''); }}>
              {accounts?.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <label className="field"><span>На счёт</span><select required value={toAccountId} onChange={(event) => setDestination(event.target.value)}>
              {accounts?.filter((account) => account.id !== fromAccountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
            <div className="form-grid">
              <label className="field"><span>Сумма, ₽</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></label>
              <label className="field"><span>Дата</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            </div>
            <label className="field"><span>Комментарий</span><input maxLength={80} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Необязательно" /></label>
            <button className="button button--primary" type="submit" disabled={busy || (accounts?.length ?? 0) < 2}>{busy ? 'Сохраняем…' : 'Перевести'}</button>
            {(accounts?.length ?? 0) < 2 && <small className="accounts-hint">Для перевода создай второй счёт.</small>}
          </form>
        </section>
      </div>
      <section className="panel accounts-history">
        <div className="panel-heading"><div><h2>История переводов</h2><p>Последние 30 переводов между счетами.</p></div></div>
        {transfers.length === 0 ? <div className="empty-state">Переводов пока нет.</div> : (
          <div className="accounts-history__list">
            {transfers.map((transfer) => <div className="accounts-history__item" key={transfer.id}>
              <div><strong>{lookup.get(transfer.fromAccountId) ?? 'Счёт'} → {lookup.get(transfer.toAccountId) ?? 'Счёт'}</strong>
                <span>{formatDate(transfer.date)}{transfer.note ? ` · ${transfer.note}` : ''}</span></div>
              <strong>{formatMoney(transfer.amountCents)}</strong>
            </div>)}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AccountsPage({ revision }: { revision: number }) {
  return <AccountsContent key={revision} />;
}
