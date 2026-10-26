import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

function calendarDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month, day));
  return date.toISOString().slice(0, 10);
}

// Caller must own the transaction and set finpilot.workspace_id before this runs.
export async function seedDemo(client: PoolClient, today: Date): Promise<void> {
  const mainId = randomUUID();
  const savingsId = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, name, kind, opening_balance_cents)
     VALUES ($1, 'Основной счёт', 'checking', 4500000), ($2, 'Накопления', 'savings', 12000000)`, [mainId, savingsId],
  );
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let offset = -5; offset <= 0; offset += 1) {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + offset;
    for (const entry of [
      { title: 'Зарплата', category: 'Зарплата', type: 'income', day: 5, amount: 14500000 },
      { title: 'Аренда квартиры', category: 'Жильё', type: 'expense', day: 6, amount: 4200000 },
      { title: 'Продукты', category: 'Продукты', type: 'expense', day: 9, amount: 820000 },
      { title: 'Транспорт', category: 'Транспорт', type: 'expense', day: 11, amount: 280000 },
      { title: 'Покупки', category: 'Покупки', type: 'expense', day: 15, amount: 690000 },
      { title: 'Подписки', category: 'Подписки', type: 'expense', day: 17, amount: 99000 },
    ] as const) {
      const date = calendarDate(year, month, entry.day);
      if (date > today.toISOString().slice(0, 10)) continue;
      await client.query(
        `INSERT INTO transactions (id, title, type, category, amount_cents, account_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
        [randomUUID(), entry.title, entry.type, entry.category, entry.amount, mainId, date],
      );
    }
  }
  const month = calendarDate(start.getUTCFullYear(), start.getUTCMonth(), 1);
  for (const [category, limit] of [['Продукты', 2000000], ['Покупки', 1200000], ['Транспорт', 600000]] as const) {
    await client.query(
      `INSERT INTO monthly_budgets (id, month, category, limit_cents) VALUES ($1, $2::date, $3, $4)`,
      [randomUUID(), month, category, limit],
    );
  }
  const firstDay = calendarDate(start.getUTCFullYear(), start.getUTCMonth() - 5, 1);
  await client.query(
    `INSERT INTO recurring_rules (id, title, type, category, amount_cents, account_id, frequency, start_date)
     VALUES ($1, 'Зарплата', 'income', 'Зарплата', 14500000, $3, 'monthly', $4::date),
            ($2, 'Аренда квартиры', 'expense', 'Жильё', 4200000, $3, 'monthly', $5::date)`,
    [randomUUID(), randomUUID(), mainId, calendarDate(start.getUTCFullYear(), start.getUTCMonth() + 1, 5), calendarDate(start.getUTCFullYear(), start.getUTCMonth() + 1, 6)],
  );
  await client.query(
    `INSERT INTO account_transfers (id, from_account_id, to_account_id, amount_cents, note, date)
     VALUES ($1, $2, $3, 300000, 'В накопления', $4::date)`,
    [randomUUID(), mainId, savingsId, firstDay],
  );
  const goalId = randomUUID();
  await client.query(
    `INSERT INTO savings_goals (id, account_id, name, target_cents, due_date)
     VALUES ($1, $2, 'Отпуск', 20000000, $3::date)`,
    [goalId, savingsId, calendarDate(today.getUTCFullYear(), today.getUTCMonth() + 8, 1)],
  );
  await client.query(
    'INSERT INTO goal_allocations (id, goal_id, delta_cents) VALUES ($1, $2, 2000000)',
    [randomUUID(), goalId],
  );
}
