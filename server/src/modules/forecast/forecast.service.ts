import { occurrencesBetween } from '../recurring/schedule.js';
import type {
  ForecastMonth, ForecastPath, ForecastRequest, ForecastResult, ForecastSnapshot,
} from './forecast.schema.js';

type Event = { date: string; type: 'income' | 'expense' | 'saving'; amountCents: number };

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function nextDay(date: string): string { return iso(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)); }

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('Forecast balance exceeds safe integer range');
  return result;
}

export function forecastEndDate(asOf: string, months: ForecastRequest['months']): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  return iso(new Date(Date.UTC(year, month - 1 + months, 0)));
}

export function forecastScenarioIsValid(request: ForecastRequest, asOf: string): boolean {
  if (!request.scenario) return true;
  const changes = 'kind' in request.scenario ? request.scenario.changes : [request.scenario];
  const through = forecastEndDate(asOf, request.months);
  return changes.every((change) => change.date > asOf && change.date <= through);
}

function virtualEvents(request: ForecastRequest, through: string): Event[] {
  if (!request.scenario) return [];
  if (!('kind' in request.scenario)) {
    const { date, amountCents } = request.scenario;
    return [{ date, type: 'expense', amountCents }];
  }
  return request.scenario.changes.flatMap((change) => {
    const dates = change.frequency === 'monthly'
      ? occurrencesBetween({ frequency: 'monthly', startDate: change.date, endDate: null }, change.date, through)
      : [change.date];
    return dates.map((date) => ({ date, type: change.type, amountCents: change.amountCents }));
  });
}

export function buildForecast(snapshot: ForecastSnapshot, request: ForecastRequest, asOf: string): ForecastResult {
  const through = forecastEndDate(asOf, request.months);
  if (!forecastScenarioIsValid(request, asOf)) throw new Error('Scenario date outside forecast period');
  const currentBalanceCents = safeAdd(snapshot.openingBalanceCents, snapshot.bookedBalanceCents);

  // Future transactions are already entered in the ledger; never count their matching
  // recurring occurrences twice. Transfers are excluded: they do not change total cash.
  const posted = new Set(snapshot.futureTransactions
    .filter((item) => item.recurringRuleId && item.recurringOccurrenceDate)
    .map((item) => `${item.recurringRuleId}:${item.recurringOccurrenceDate}`));
  const events: Event[] = snapshot.futureTransactions.map(({ date, type, amountCents }) => ({ date, type, amountCents }));
  for (const rule of snapshot.recurringRules) {
    for (const date of occurrencesBetween(rule, nextDay(asOf), through)) {
      if (!posted.has(`${rule.id}:${date}`)) events.push({ date, type: rule.type, amountCents: rule.amountCents });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  let balance = currentBalanceCents;
  let scenarioBalance = currentBalanceCents;
  const baseline: ForecastPath = {
    lowestBalanceCents: balance, firstNegativeDate: balance < 0 ? asOf : null,
  };
  const withScenario: ForecastPath = {
    lowestBalanceCents: scenarioBalance, firstNegativeDate: scenarioBalance < 0 ? asOf : null,
  };
  const months: ForecastMonth[] = [];
  const virtual = virtualEvents(request, through).sort((a, b) => a.date.localeCompare(b.date));
  const dateSet = new Set([...events, ...virtual].map((event) => event.date));
  const dates = [...dateSet].sort();
  let eventIndex = 0;
  let virtualIndex = 0;
  let dateIndex = 0;
  let monthCursor = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);

  for (let monthIndex = 0; monthIndex < request.months; monthIndex += 1) {
    const month = monthCursor.toISOString().slice(0, 7);
    monthCursor = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1));
    const endOfMonth = iso(new Date(monthCursor.getTime() - 86_400_000));
    let incomeCents = 0;
    let expenseCents = 0;

    while (dateIndex < dates.length && dates[dateIndex]! <= endOfMonth) {
      const date = dates[dateIndex]!;
      while (eventIndex < events.length && events[eventIndex]!.date === date) {
        const event = events[eventIndex]!;
        const delta = event.type === 'income' ? event.amountCents : -event.amountCents;
        balance = safeAdd(balance, delta);
        scenarioBalance = safeAdd(scenarioBalance, delta);
        if (event.type === 'income') incomeCents = safeAdd(incomeCents, event.amountCents);
        else expenseCents = safeAdd(expenseCents, event.amountCents);
        eventIndex += 1;
      }
      while (virtualIndex < virtual.length && virtual[virtualIndex]!.date === date) {
        const change = virtual[virtualIndex]!;
        scenarioBalance = safeAdd(scenarioBalance, change.type === 'expense' ? -change.amountCents : change.amountCents);
        virtualIndex += 1;
      }
      baseline.lowestBalanceCents = Math.min(baseline.lowestBalanceCents, balance);
      withScenario.lowestBalanceCents = Math.min(withScenario.lowestBalanceCents, scenarioBalance);
      if (balance < 0 && baseline.firstNegativeDate === null) baseline.firstNegativeDate = date;
      if (scenarioBalance < 0 && withScenario.firstNegativeDate === null) withScenario.firstNegativeDate = date;
      dateIndex += 1;
    }
    months.push({ month, baselineCents: balance, scenarioCents: scenarioBalance, incomeCents, expenseCents });
  }

  return { asOf, through, currentBalanceCents, plannedEvents: events.length, scenario: request.scenario,
    baseline, withScenario, months };
}
