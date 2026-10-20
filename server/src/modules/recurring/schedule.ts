import type { RecurringRule } from './recurring.schema.js';

type Schedule = Pick<RecurringRule, 'frequency' | 'startDate' | 'endDate'>;
const DAY_MS = 86_400_000;

function utcDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function iso(value: Date): string { return value.toISOString().slice(0, 10); }

function monthlyOccurrence(start: Date, index: number): Date {
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return first;
}

// Calendar dates are evaluated in UTC to avoid DST changing weekly intervals.
// A monthly rule starting on the 31st runs on the last day of shorter months.
export function occurrencesBetween(rule: Schedule, from: string, through: string, max = 400): string[] {
  if (from > through || max < 1) return [];
  const start = utcDate(rule.startDate);
  const lower = Math.max(utcDate(from).getTime(), start.getTime());
  const upper = Math.min(utcDate(through).getTime(), rule.endDate ? utcDate(rule.endDate).getTime() : Infinity);
  if (lower > upper) return [];

  let index: number;
  if (rule.frequency === 'weekly') {
    index = Math.max(0, Math.ceil((lower - start.getTime()) / (7 * DAY_MS)));
  } else {
    const first = new Date(lower);
    index = Math.max(0, (first.getUTCFullYear() - start.getUTCFullYear()) * 12 + first.getUTCMonth() - start.getUTCMonth());
  }

  const results: string[] = [];
  for (;;) {
    const occurrence = rule.frequency === 'weekly'
      ? new Date(start.getTime() + index * 7 * DAY_MS)
      : monthlyOccurrence(start, index);
    if (occurrence.getTime() > upper) break;
    if (occurrence.getTime() >= lower) {
      results.push(iso(occurrence));
      if (results.length > max) throw new Error('Recurring schedule exceeds the allowed range');
    }
    index += 1;
  }
  return results;
}

export function nextOccurrences(rule: Schedule, on: string, count = 3): string[] {
  if (count <= 0) return [];
  // Three monthly/weekly occurrences always fit into a 2-year view.
  const horizon = new Date(utcDate(on).getTime());
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
  return occurrencesBetween(rule, on, iso(horizon)).slice(0, count);
}

export function utcToday(now: Date): string { return now.toISOString().slice(0, 10); }

export function oneYearBack(today: string): string {
  const date = utcDate(today);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return iso(date);
}
