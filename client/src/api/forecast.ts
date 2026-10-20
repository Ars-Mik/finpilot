import { request } from './transactions';

export type ForecastMonths = 3 | 6 | 12;
export type ForecastScenario = { title: string; amountCents: number; date: string };
export type ForecastMonth = {
  month: string;
  baselineCents: number;
  scenarioCents: number;
  incomeCents: number;
  expenseCents: number;
};
export type ForecastPath = { lowestBalanceCents: number; firstNegativeDate: string | null };
export type ForecastResult = {
  asOf: string;
  through: string;
  currentBalanceCents: number;
  plannedEvents: number;
  scenario: ForecastScenario | null;
  baseline: ForecastPath;
  withScenario: ForecastPath;
  months: ForecastMonth[];
};

export async function simulateForecast(
  months: ForecastMonths,
  scenario: ForecastScenario | null,
  signal?: AbortSignal,
): Promise<ForecastResult> {
  const response = await request<{ data: ForecastResult }>('/api/forecast/simulate', {
    method: 'POST',
    body: JSON.stringify({ months, scenario }),
    signal,
  });
  if (!response.data || !Array.isArray(response.data.months) || response.data.months.length !== months
    || !Number.isSafeInteger(response.data.currentBalanceCents)) {
    throw new Error('Некорректный ответ API финансового прогноза.');
  }
  return response.data;
}
