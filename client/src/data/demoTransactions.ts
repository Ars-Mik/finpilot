import type { Transaction } from '../types/finance';

const templates = [
  { title: 'Зарплата', category: 'Зарплата', type: 'income', amountCents: 148_000_00, day: 5 },
  { title: 'Аренда квартиры', category: 'Жильё', type: 'expense', amountCents: 43_000_00, day: 6 },
  { title: 'Продукты на неделю', category: 'Продукты', type: 'expense', amountCents: 7_840_00, day: 8 },
  { title: 'Проездной', category: 'Транспорт', type: 'expense', amountCents: 3_200_00, day: 10 },
  { title: 'Подработка', category: 'Подработка', type: 'income', amountCents: 18_500_00, day: 12 },
  { title: 'Подписки на сервисы', category: 'Подписки', type: 'expense', amountCents: 1_490_00, day: 14 },
  { title: 'Кафе и рестораны', category: 'Досуг', type: 'expense', amountCents: 4_650_00, day: 16 },
  { title: 'Покупки для дома', category: 'Покупки', type: 'expense', amountCents: 12_400_00, day: 19 },
  { title: 'Продукты', category: 'Продукты', type: 'expense', amountCents: 6_150_00, day: 24 },
] as const;

export function createDemoTransactions(): Transaction[] {
  const today = new Date();
  const items: Transaction[] = [];

  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo -= 1) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const year = monthDate.getFullYear();
    const month = String(monthDate.getMonth() + 1).padStart(2, '0');

    templates.forEach((template, index) => {
      if (monthsAgo === 0 && template.day > today.getDate()) return;

      const variation = (monthsAgo % 3) * 110_00;
      items.push({
        id: `demo-${monthsAgo}-${index}`,
        title: template.title,
        category: template.category,
        type: template.type,
        amountCents: template.amountCents + (template.type === 'expense' ? variation : 0),
        date: `${year}-${month}-${String(template.day).padStart(2, '0')}`,
      });
    });
  }

  return items;
}
