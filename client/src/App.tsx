import { useRef, useState } from 'react';
import { AlertCircle, ArrowLeftRight, ChartNoAxesCombined, LayoutDashboard, Landmark, Target, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { createTransaction, removeTransaction, resetDemoTransactions, updateTransaction } from './api/transactions';
import TransactionForm from './components/TransactionForm';
import { createDemoTransactions } from './data/demoTransactions';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import BudgetsPage from './pages/BudgetsPage';
import TransactionsPage from './pages/TransactionsPage';
import type { Transaction, TransactionInput } from './types/finance';
import './App.css';

function AppContent() {
  const [revision, setRevision] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formTransaction, setFormTransaction] = useState<Transaction | null | undefined>(undefined);
  const busyRef = useRef(false);
  const location = useLocation();

  async function mutate(operation: () => Promise<unknown>): Promise<void> {
    if (busyRef.current) throw new Error('Дождись завершения предыдущей операции.');
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await operation();
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.');
      throw cause;
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }

  function handleDelete(id: string) {
    void mutate(() => removeTransaction(id)).catch(() => {
      // The error is displayed above the current page.
    });
  }

  async function handleResetDemo() {
    if (!window.confirm('Удалить все операции из локальной базы и загрузить демонстрационные данные?')) return;
    const demo = createDemoTransactions().map(({ title, type, category, date, amountCents }) => ({
      title, type, category, date, amountCents,
    }));
    try {
      await mutate(() => resetDemoTransactions(demo));
    } catch {
      // The database might contain partially replaced data; refresh both pages.
      setRevision((value) => value + 1);
    }
  }

  const links = [
    { to: '/', label: 'Обзор', icon: LayoutDashboard, end: true },
    { to: '/transactions', label: 'Операции', icon: ArrowLeftRight, end: false },
    { to: '/accounts', label: 'Счета', icon: Landmark, end: false },
    { to: '/budgets', label: 'Бюджеты', icon: Target, end: false },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="FinPilot — главная">
          <span className="brand__icon"><ChartNoAxesCombined size={24} strokeWidth={2.5} /></span>
          <span>Fin<span className="brand__accent">Pilot</span><small>finance made clear</small></span>
        </NavLink>
        <div className="sidebar__section-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="sidebar__nav" aria-label="Основная навигация">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <div className="privacy-note"><ShieldCheck size={21} /><div><strong>Локальная разработка</strong><span>Операции хранятся в PostgreSQL. Авторизация пока не подключена.</span></div></div>
          {import.meta.env.DEV && (
            <button className="sidebar__reset" type="button" disabled={isBusy} onClick={() => { void handleResetDemo(); }}>
              <RotateCcw size={16} /> {isBusy ? 'Подожди…' : 'Загрузить демоданные'}
            </button>
          )}
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar__location"><span>FinPilot</span><span className="topbar__separator">/</span><strong>{location.pathname === '/transactions' ? 'Операции' : location.pathname === '/accounts' ? 'Счета' : location.pathname === '/budgets' ? 'Бюджеты' : 'Обзор'}</strong></div>
          <button className="button button--primary" type="button" disabled={isBusy} onClick={() => setFormTransaction(null)}>
            <Plus size={19} /> <span>Новая операция</span>
          </button>
        </header>
        <main className="page-content">
          {error && (
            <div className="api-alert" role="alert">
              <AlertCircle size={19} />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}>Закрыть</button>
            </div>
          )}
          <Routes>
            <Route path="/" element={<DashboardPage revision={revision} />} />
            <Route path="/transactions" element={<TransactionsPage revision={revision} onDelete={handleDelete} onEdit={setFormTransaction} isBusy={isBusy} />} />
            <Route path="/accounts" element={<AccountsPage revision={revision} />} />
            <Route path="/budgets" element={<BudgetsPage revision={revision} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {formTransaction !== undefined && (
        <TransactionForm
          key={formTransaction?.id ?? 'new'}
          transaction={formTransaction ?? undefined}
          onSave={formTransaction
            ? (input) => mutate(() => updateTransaction(formTransaction.id, input))
            : (input: TransactionInput) => mutate(() => createTransaction(input))}
          onClose={() => setFormTransaction(undefined)}
        />
      )}
    </div>
  );
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}
