import { ArrowDownLeft, ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { formatDate, formatMoney } from '../lib/finance';
import type { Transaction } from '../types/finance';

type TransactionListProps = {
  transactions: readonly Transaction[];
  onDelete?: (id: string) => void;
  onEdit?: (transaction: Transaction) => void;
  isBusy?: boolean;
};

export default function TransactionList({ transactions, onDelete, onEdit, isBusy = false }: TransactionListProps) {
  if (transactions.length === 0) {
    return <div className="empty-state">Операции не найдены. Измени фильтры или добавь новую операцию.</div>;
  }

  return (
    <div className="transaction-list">
      {transactions.map((transaction) => (
        <div className="transaction-row" key={transaction.id}>
          <div className={`transaction-icon transaction-icon--${transaction.type}`} aria-hidden="true">
            {transaction.type === 'income' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
          </div>
          <div className="transaction-row__details">
            <span className="transaction-row__title">{transaction.title}</span>
            <span className="transaction-row__meta">{transaction.category} · {formatDate(transaction.date)}</span>
          </div>
          <strong className={`transaction-row__amount transaction-row__amount--${transaction.type}`}>
            {transaction.type === 'income' ? '+' : '−'}{formatMoney(transaction.amountCents)}
          </strong>
          {(onEdit || onDelete) && (
            <div className="transaction-row__actions" role="group" aria-label={`Действия: ${transaction.title}`}>
              {onEdit && (
                <button
                  className="icon-button transaction-row__edit"
                  type="button"
                  disabled={isBusy}
                  aria-label={`Редактировать операцию ${transaction.title}`}
                  title="Редактировать операцию"
                  onClick={() => onEdit(transaction)}
                >
                  <Pencil size={17} />
                </button>
              )}
              {onDelete && (
                <button
                  className="icon-button transaction-row__delete"
                  type="button"
                  disabled={isBusy}
                  aria-label={`Удалить операцию ${transaction.title}`}
                  title="Удалить операцию"
                  onClick={() => {
                    if (window.confirm(`Удалить операцию «${transaction.title}»?`)) onDelete(transaction.id);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
