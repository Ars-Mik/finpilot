import { expect, test, type Page } from '@playwright/test';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

function monthsEndingAt(through: string, count: number): string[] {
  const [year = 2026, month = 10] = through.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function responseFor(url: URL, method: string, body: unknown) {
  const path = url.pathname;
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  if (path === '/api/accounts') return { data: [{ id: ACCOUNT_ID, name: 'Основной счёт', kind: 'checking', openingBalanceCents: 0, balanceCents: 10000000 }] };
  if (path === '/api/transfers') return { data: [] };
  if (path === '/api/transactions/overview') {
    const months = monthsEndingAt(url.searchParams.get('currentMonth') ?? currentMonth, 6);
    return { data: { total: 0, balanceCents: 10000000, selected: { incomeCents: 0, expenseCents: 0 }, months: months.map((month) => ({ month, incomeCents: 0, expenseCents: 0 })), categories: [], recent: [] } };
  }
  if (path === '/api/transactions') return { data: [], meta: { page: 1, limit: 10, total: 0, totals: { incomeCents: 0, expenseCents: 0 } } };
  if (path === '/api/budgets') {
    const month = url.searchParams.get('month') ?? currentMonth;
    return { data: { month, budgets: [{ id: '00000000-0000-4000-8000-000000000002', month, category: 'Жильё', limitCents: 500000, spentCents: 600000, remainingCents: -100000 }, { id: '00000000-0000-4000-8000-000000000003', month, category: 'Продукты', limitCents: 1000000, spentCents: 100000, remainingCents: 900000 }], totalLimitCents: 1500000, coveredSpentCents: 700000, totalSpentCents: 700000, unbudgetedSpentCents: 0, overLimitCount: 1 } };
  }
  if (path === '/api/recurring') return { data: [] };
  if (path === '/api/analytics') {
    const through = url.searchParams.get('through') ?? currentMonth;
    const count = Number(url.searchParams.get('months') ?? 6);
    const list = monthsEndingAt(through, count);
    return { data: {
      period: { from: list[0], through, months: count },
      current: { incomeCents: 15000000, expenseCents: 7500000, netCents: 7500000, transactions: 2 },
      previous: { from: '2025-01', through: '2025-06', incomeCents: 0, expenseCents: 0, netCents: 0 },
      monthly: list.map((month) => ({ month, incomeCents: 15000000 / count, expenseCents: 7500000 / count, netCents: 7500000 / count, transactions: 1 })),
      categories: [{ category: 'Продукты', transactions: 1, expenseCents: 7500000 }],
      accounts: [{ accountId: ACCOUNT_ID, accountName: 'Основной счёт', incomeCents: 15000000, expenseCents: 7500000 }],
    } };
  }
  if (path === '/api/forecast/simulate' && method === 'POST') {
    const input = body as { months: number; scenario: { title: string; amountCents: number; date: string } | null };
    const months = Array.from({ length: input.months }, (_, index) => {
      const date = new Date(`${currentMonth}-01T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + index);
      const month = date.toISOString().slice(0, 7);
      return { month, baselineCents: 10000000, scenarioCents: 10000000 - (input.scenario?.amountCents ?? 0), incomeCents: 0, expenseCents: 0 };
    });
    return { data: { asOf: today, through: `${months.at(-1)?.month ?? currentMonth}-28`, currentBalanceCents: 10000000, plannedEvents: 0, scenario: input.scenario, baseline: { lowestBalanceCents: 10000000, firstNegativeDate: null }, withScenario: { lowestBalanceCents: 10000000 - (input.scenario?.amountCents ?? 0), firstNegativeDate: null }, months } };
  }
  return { error: { code: 'NOT_FOUND', message: `Missing fixture: ${method} ${path}` } };
}

async function mockApi(page: Page) {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('finpilot.theme')) window.localStorage.setItem('finpilot.theme', 'light');
  });
  await page.route(
  (url) => url.pathname.startsWith('/api/'),
  async (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Accept',
    };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let body: unknown = null;
    if (req.postData()) {
      try { body = req.postDataJSON(); } catch { body = null; }
    }
    const result = responseFor(new URL(req.url()), req.method(), body);
    await route.fulfill({ status: 'error' in result ? 404 : 200, json: result, headers });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('all seven application sections open without API errors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Обзор финансов', level: 1 })).toBeVisible();
  for (const [link, heading] of [
    ['Операции', 'Операции'], ['Счета', 'Счета'], ['Бюджеты', 'Бюджеты'],
    ['Регулярные', 'Регулярные операции'], ['Прогноз', 'Прогноз и сценарии'], ['Аналитика', 'Аналитика'],
  ]) {
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
});

test('theme persists after a full reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('transaction dialog opens and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новая операция' }).click();
  await expect(page.getByRole('dialog', { name: 'Добавить операцию' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('budget UI shows category overrun without offsetting other categories', async ({ page }) => {
  await page.goto('/budgets');
  await expect(page.getByText('Превышение по категориям')).toBeVisible();
  await expect(page.getByText('Расходы в категориях с лимитами')).toBeVisible();
  await expect(page.getByText('Превышение: 1 000 ₽')).toBeVisible();
});

test('analytics explains an empty previous period', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByText('Нет данных за предыдущий период').first()).toBeVisible();
});

test('mobile navigation can be opened and closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Счета' }).click();
  await expect(page.getByRole('heading', { name: 'Счета', level: 1 })).toBeVisible();
});
