import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { todayLocal } from '../lib/finance';
import { getAccounts, type Account } from '../api/accounts';
import { CATEGORIES, type Transaction, type TransactionInput, type TransactionType } from '../types/finance';

type TransactionFormProps = {
  transaction?: Transaction;
  onClose: () => void;
  onSave: (transaction: TransactionInput) => Promise<void>;
};

export default function TransactionForm({ transaction, onClose, onSave }: TransactionFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense');
  const [title, setTitle] = useState(transaction?.title ?? '');
  const [amount, setAmount] = useState(transaction ? (transaction.amountCents / 100).toFixed(2).replace('.', ',') : '');
  const [category, setCategory] = useState<string>(transaction?.category ?? CATEGORIES.expense[0]);
  const [date, setDate] = useState(transaction?.date ?? todayLocal());
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountId, setAccountId] = useState(transaction?.accountId ?? '');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getAccounts(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setAccounts(result); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось получить счета.');
      })
      .finally(() => { if (!controller.signal.aborted) setAccountsLoading(false); });
    return () => controller.abort();
  }, []);

  function changeType(nextType: TransactionType) {
    setType(nextType);
    setCategory(CATEGORIES[nextType][0]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedAmount = amount.trim().replace(',', '.');
    const numericAmount = Number(normalizedAmount);
    const amountCents = Math.round(numericAmount * 100);

    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount)
      || !Number.isSafeInteger(amountCents)
      || amountCents <= 0) {
      setError('Укажи сумму больше нуля, не более двух знаков после запятой.');
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Укажи название операции.');
      return;
    }

    if (!CATEGORIES[type].includes(category) || !date || date > todayLocal()) {
      setError('Проверь категорию и дату операции.');
      return;
    }

    const selectedAccountId = accountId || accounts[0]?.id;
    if (!selectedAccountId) {
      setError('Не удалось выбрать счёт. Проверь подключение к API.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSave({ type, title: trimmedTitle, amountCents, category, date, accountId: selectedAccountId });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить операцию.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <dialog
      className="transaction-dialog"
      ref={dialogRef}
      onCancel={(event) => { if (isSubmitting) event.preventDefault(); else onClose(); }}
      aria-labelledby="transaction-dialog-title"
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">{transaction ? 'Изменение записи' : 'Новая запись'}</div>
          <h2 id="transaction-dialog-title">{transaction ? 'Редактировать операцию' : 'Добавить операцию'}</h2>
        </div>
        <button className="icon-button" type="button" disabled={isSubmitting} onClick={onClose} aria-label="Закрыть окно"><X size={20} /></button>
      </div>
      <form onSubmit={(event) => { void handleSubmit(event); }} className="transaction-form" aria-busy={isSubmitting}>
        <fieldset className="form-fields" disabled={isSubmitting || accountsLoading}>
          <div className="type-switch" role="group" aria-label="Тип операции">
            <button type="button" aria-pressed={type === 'expense'} className={type === 'expense' ? 'type-switch__active' : ''} onClick={() => changeType('expense')}>Расход</button>
            <button type="button" aria-pressed={type === 'income'} className={type === 'income' ? 'type-switch__active' : ''} onClick={() => changeType('income')}>Доход</button>
          </div>
          <label className="field"><span>Счёт</span>
            <select required value={accountId || accounts[0]?.id || ''} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Название</span>
            <input autoFocus required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, продукты" />
          </label>
          <label className="field"><span>Сумма, ₽</span>
            <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" />
          </label>
          <div className="form-grid">
            <label className="field"><span>Категория</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {CATEGORIES[type].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="field"><span>Дата</span>
              <input type="date" required max={todayLocal()} value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button button--secondary" type="button" disabled={isSubmitting} onClick={onClose}>Отмена</button>
          <button className="button button--primary" type="submit" disabled={isSubmitting || accountsLoading || accounts.length === 0}>{isSubmitting ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </dialog>
  );
}
