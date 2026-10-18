import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';
import { formatMoney } from '../lib/finance';

type BalanceCardProps = {
  balanceCents: number;
  monthBalanceCents: number;
  periodLabel: string;
};

export default function BalanceCard({ balanceCents, monthBalanceCents, periodLabel }: BalanceCardProps) {
  return (
    <section className="balance-card" aria-label="Сводка баланса">
      <div className="balance-card__content">
        <div className="balance-card__label"><Wallet size={18} /> Баланс операций</div>
        <div className="balance-card__amount">{formatMoney(balanceCents)}</div>
        <div className="balance-card__foot">
          <span className="balance-card__delta">{monthBalanceCents >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />} {formatMoney(monthBalanceCents)}</span>
          <span>Доходы минус расходы · {periodLabel}</span>
        </div>
      </div>
      <div className="balance-card__decoration" aria-hidden="true" />
    </section>
  );
}
