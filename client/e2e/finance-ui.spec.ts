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
  if (path === '/api/session') return { data: { csrfToken: 'a'.repeat(64), mode: 'guest' } };
  if (path === '/api/demo/reset') return { data: { reset: true } };
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
  if (path === '/api/goals') return { data: [] };
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
    const input = body as { months: number; scenario: { title: string; amountCents: number; date: string } | { kind: 'plan'; changes: { type: 'income' | 'expense' | 'saving'; frequency: 'once' | 'monthly'; amountCents: number; date: string }[] } | null };
    const changes = input.scenario ? ('kind' in input.scenario ? input.scenario.changes : [
      { type: 'expense' as const, frequency: 'once' as const, amountCents: input.scenario.amountCents, date: input.scenario.date },
    ]) : [];
    let runningImpact = 0;
    const months = Array.from({ length: input.months }, (_, index) => {
      const date = new Date(`${currentMonth}-01T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + index);
      const month = date.toISOString().slice(0, 7);
      for (const change of changes) {
        const applies = change.frequency === 'monthly' ? month >= change.date.slice(0, 7) : month === change.date.slice(0, 7);
        if (applies) runningImpact += (change.type === 'expense' ? -1 : 1) * change.amountCents;
      }
      return { month, baselineCents: 10000000, scenarioCents: 10000000 + runningImpact, incomeCents: 0, expenseCents: 0 };
    });
    return { data: { asOf: today, through: `${months.at(-1)?.month ?? currentMonth}-28`, currentBalanceCents: 10000000, plannedEvents: 0, scenario: input.scenario, baseline: { lowestBalanceCents: 10000000, firstNegativeDate: null }, withScenario: { lowestBalanceCents: Math.min(10000000, ...months.map((entry) => entry.scenarioCents)), firstNegativeDate: null }, months } };
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

test('all eight application sections open without API errors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Обзор финансов', level: 1 })).toBeVisible();
  for (const [link, heading] of [
    ['Операции', 'Операции'], ['Счета', 'Счета'], ['Бюджеты', 'Бюджеты'],
    ['Регулярные', 'Регулярные операции'], ['Цели', 'Финансовые цели'], ['Прогноз', 'Прогноз и сценарии'], ['Аналитика', 'Аналитика'],
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


test('demo reset uses the guest session CSRF token', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/demo/reset')) seen.push(request.headers()['x-finpilot-csrf'] ?? '');
  });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Загрузить демоданные' }).click();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0]).toBe('a'.repeat(64));
});


test('goals can be created, funded, edited and archived with CSRF protection', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000044';
  const dueDate = new Date();
  dueDate.setFullYear(dueDate.getFullYear() + 1);
  const deadline = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
  let goal: {
    id: string; name: string; accountId: string; targetCents: number; dueDate: string;
    status: 'active' | 'archived'; reservedCents: number; remainingCents: number;
    accountBalanceCents: number; accountReservedCents: number;
  } | null = null;
  let csrfMutations = 0;
  const allocations: { id: string; goalId: string; deltaCents: number; createdAt: string }[] = [];

  await page.route((url) => url.pathname.startsWith('/api/goals'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (method !== 'GET') {
      expect(req.headers()['x-finpilot-csrf']).toBe('a'.repeat(64));
      csrfMutations++;
    }
    if (path === '/api/goals' && method === 'GET') {
      await route.fulfill({ json: { data: goal ? [goal] : [] } });
    } else if (path === '/api/goals' && method === 'POST') {
      const input = req.postDataJSON() as { name: string; accountId: string; targetCents: number; dueDate: string };
      goal = { ...input, id, status: 'active', reservedCents: 0, remainingCents: input.targetCents,
        accountBalanceCents: 10000000, accountReservedCents: 0 };
      await route.fulfill({ status: 201, json: { data: goal } });
    } else if (path === `/api/goals/${id}` && method === 'PATCH' && goal) {
      const input = req.postDataJSON() as { name: string; targetCents: number; dueDate: string };
      goal = { ...goal, ...input, remainingCents: input.targetCents - goal.reservedCents };
      await route.fulfill({ json: { data: goal } });
    } else if (path === `/api/goals/${id}/allocations` && method === 'POST' && goal) {
      const input = req.postDataJSON() as { action: 'reserve' | 'release'; amountCents: number };
      const delta = input.action === 'reserve' ? input.amountCents : -input.amountCents;
      if (delta > goal.accountBalanceCents - goal.accountReservedCents) {
        await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'Insufficient funds' } } });
        return;
      }
      goal = { ...goal, reservedCents: goal.reservedCents + delta,
        remainingCents: goal.remainingCents - delta, accountReservedCents: goal.accountReservedCents + delta };
      allocations.unshift({ id: String(allocations.length), goalId: id, deltaCents: delta, createdAt: new Date().toISOString() });
      await route.fulfill({ status: 201, json: { data: goal } });
    } else if (path === `/api/goals/${id}/allocations` && method === 'GET') {
      await route.fulfill({ json: { data: allocations } });
    } else if (path === `/api/goals/${id}/archive` && method === 'POST' && goal) {
      goal = { ...goal, status: 'archived', reservedCents: 0, accountReservedCents: 0,
        remainingCents: goal.targetCents };
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    }
  });

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Финансовые цели', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Название' }).fill('Отпуск');
  await page.getByRole('textbox', { name: 'Сумма цели, ₽' }).fill('200000');
  await page.getByLabel('Срок').fill(deadline);
  await page.getByRole('button', { name: 'Создать цель' }).click();
  await expect(page.getByRole('heading', { name: 'Отпуск' })).toBeVisible();
  await page.getByRole('button', { name: 'Пополнить' }).click();
  await page.getByRole('textbox', { name: 'Зарезервировать, ₽' }).fill('150000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('alert')).toContainText('Не хватает свободных средств');
  await page.getByRole('textbox', { name: 'Зарезервировать, ₽' }).fill('40000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('progressbar', { name: 'Прогресс: Отпуск' })).toHaveAttribute('aria-valuenow', '20');
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await page.getByRole('textbox', { name: 'Вернуть в свободный остаток, ₽' }).fill('10000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('progressbar', { name: 'Прогресс: Отпуск' })).toHaveAttribute('aria-valuenow', '15');
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByRole('heading', { name: 'История резервирований' })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByRole('textbox', { name: 'Название' }).fill('Отпуск у моря');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.getByRole('heading', { name: 'Отпуск у моря' })).toBeVisible();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Архив' , exact: true }).click();
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Отпуск у моря' })).toBeVisible();
  expect(csrfMutations).toBe(6);
});


test('forecast compares recurring income and one-time expenses without saving transactions', async ({ page }) => {
  const future = new Date();
  future.setUTCMonth(future.getUTCMonth() + 1, 5);
  const changeDate = future.toISOString().slice(0, 10);
  const requests: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/forecast/simulate') && request.method() === 'POST') requests.push(request.postDataJSON());
  });
  await page.goto('/forecast');
  await page.getByLabel('Название', { exact: true }).fill('Подработка');
  await page.getByLabel('Тип изменения').selectOption('income');
  await page.getByLabel('Периодичность').selectOption('monthly');
  await page.getByLabel('Сумма, ₽').fill('10000');
  await page.getByLabel('Дата первого изменения').fill(changeDate);
  await page.getByRole('button', { name: 'Добавить в сценарий' }).click();
  await expect(page.getByText('Добавленные изменения')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать Подработка' })).toBeVisible();
  await expect(page.getByText('Влияние сценария к концу периода')).toBeVisible();
  await page.getByLabel('Название', { exact: true }).fill('Ноутбук');
  await page.getByLabel('Тип изменения').selectOption('expense');
  await page.getByLabel('Периодичность').selectOption('once');
  await page.getByLabel('Сумма, ₽').fill('5000');
  await page.getByLabel('Дата', { exact: true }).fill(changeDate);
  await page.getByRole('button', { name: 'Добавить в сценарий' }).click();
  await expect(page.getByRole('button', { name: 'Убрать Ноутбук' })).toBeVisible();
  expect(requests.some((payload) => {
    const input = payload as { scenario?: { changes?: unknown[] } };
    return input.scenario?.changes?.length === 2;
  })).toBe(true);
  expect(requests.some((payload) => {
    const input = payload as { scenario?: { kind?: string; changes?: { type: string; frequency: string }[] } };
    return input.scenario?.kind === 'plan' && input.scenario.changes?.[0]?.type === 'income'
      && input.scenario.changes[0]?.frequency === 'monthly';
  })).toBe(true);
  await page.getByRole('button', { name: 'Убрать Подработка' }).click();
  await expect(page.getByRole('button', { name: 'Убрать Ноутбук' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать Ноутбук' }).click();
  await expect(page.getByText('Добавленные изменения')).toHaveCount(0);
  await expect(page.getByText('Влияние сценария к концу периода')).toHaveCount(0);
});
