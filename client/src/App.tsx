import { useState } from 'react';
import { AlertCircle, ArrowLeftRight, ChartNoAxesCombined, LayoutDashboard, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import TransactionForm from './components/TransactionForm';
import { useTransactions } from './hooks/useTransactions';
import type { Transaction } from './types/finance';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import './App.css';

function AppContent() {
  const {
    transactions, isLoading, isBusy, error, refresh, clearError,
    addTransaction, editTransaction, deleteTransaction, resetDemo,
  } = useTransactions();
  const [formTransaction, setFormTransaction] = useState<Transaction | null | undefined>(undefined);
  const location = useLocation();

  const links = [
    { to: '/', label: 'Обзор', icon: LayoutDashboard, end: true },
    { to: '/transactions', label: 'Операции', icon: ArrowLeftRight, end: false },
  ];

  async function handleResetDemo() {
    if (!window.confirm('Удалить все операции из локальной базы и загрузить демонстрационные данные?')) return;
    try {
      await resetDemo();
    } catch {
      // Error is displayed by the hook; the final data set is reloaded from PostgreSQL.
    }
  }

  function handleDelete(id: string) {
    void deleteTransaction(id).catch(() => {
      // Error is displayed by the hook; retain the operation on failed deletion.
    });
  }

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
          <button className="sidebar__reset" type="button" disabled={isLoading || isBusy} onClick={() => { void handleResetDemo(); }}>
            <RotateCcw size={16} /> {isBusy ? 'Подожди…' : 'Загрузить демоданные'}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar__location"><span>FinPilot</span><span className="topbar__separator">/</span><strong>{location.pathname === '/transactions' ? 'Операции' : 'Обзор'}</strong></div>
          <button className="button button--primary" type="button" disabled={isLoading || isBusy} onClick={() => setFormTransaction(null)}>
            <Plus size={19} /> <span>Новая операция</span>
          </button>
        </header>
        <main className="page-content">
          {error && (
            <div className="api-alert" role="alert">
              <AlertCircle size={19} />
              <span>{error}</span>
              <button type="button" onClick={() => { clearError(); void refresh(); }}>Повторить</button>
            </div>
          )}
          {isLoading ? (
            <div className="data-state" role="status">Загружаем операции…</div>
          ) : error && transactions.length === 0 ? (
            <div className="data-state">Нет подключения к базе данных. Проверь сервер и повтори загрузку.</div>
          ) : (
            <>
              {transactions.length === 0 && (
                <div className="welcome-banner">
                  <div><strong>База операций пуста</strong><span>Добавь первую операцию или загрузи тестовые данные.</span></div>
                  <button className="button button--secondary" type="button" disabled={isBusy} onClick={() => { void handleResetDemo(); }}>Загрузить демоданные</button>
                </div>
              )}
              <Routes>
                <Route path="/" element={<DashboardPage transactions={transactions} />} />
                <Route path="/transactions" element={<TransactionsPage transactions={transactions} onDelete={handleDelete} onEdit={setFormTransaction} isBusy={isBusy} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </>
          )}
        </main>
      </div>

      {formTransaction !== undefined && (
        <TransactionForm
          key={formTransaction?.id ?? 'new'}
          transaction={formTransaction ?? undefined}
          onSave={formTransaction
            ? (input) => editTransaction(formTransaction.id, input)
            : addTransaction}
          onClose={() => setFormTransaction(undefined)}
        />
      )}
    </div>
  );
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}
