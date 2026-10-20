-- Monthly limits apply to expenses across every account. Transfers are not expenses.
-- The date is the first day of a calendar month; old transactions remain unchanged.
CREATE TABLE monthly_budgets (
    id UUID PRIMARY KEY,
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    category VARCHAR(60) NOT NULL CHECK (category IN ('Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Покупки', 'Досуг', 'Другое')),
    limit_cents BIGINT NOT NULL CHECK (limit_cents BETWEEN 1 AND 1000000000000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_monthly_budgets_month_category UNIQUE (month, category)
);

CREATE INDEX idx_budget_expenses_month_category ON transactions (date, category)
    WHERE type = 'expense';
