import { useState } from 'react';
import { ArrowLeftRight, ChartNoAxesCombined, LayoutDashboard, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import TransactionForm from './components/TransactionForm';
import { useTransactions } from './hooks/useTransactions';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import './App.css';

function AppContent() {
  const { transactions, addTransaction, deleteTransaction, resetDemo } = useTransactions();
  const [isFormOpen, setFormOpen] = useState(false);
  const location = useLocation();

  const links = [
    { to: '/', label: 'Обзор', icon: LayoutDashboard, end: true },
    { to: '/transactions', label: 'Операции', icon: ArrowLeftRight, end: false },
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
          <div className="privacy-note"><ShieldCheck size={21} /><div><strong>Демо-режим</strong><span>Данные сохраняются только в этом браузере.</span></div></div>
          <button className="sidebar__reset" type="button" onClick={() => { if (window.confirm('Сбросить операции и восстановить демонстрационные данные?')) resetDemo(); }}><RotateCcw size={16} /> Сбросить демоданные</button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar__location"><span>FinPilot</span><span className="topbar__separator">/</span><strong>{location.pathname === '/transactions' ? 'Операции' : 'Обзор'}</strong></div>
          <button className="button button--primary" type="button" onClick={() => setFormOpen(true)}><Plus size={19} /> <span>Новая операция</span></button>
        </header>
        <main className="page-content">
          <Routes>
            <Route path="/" element={<DashboardPage transactions={transactions} />} />
            <Route path="/transactions" element={<TransactionsPage transactions={transactions} onDelete={deleteTransaction} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {isFormOpen && <TransactionForm onSave={addTransaction} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}
