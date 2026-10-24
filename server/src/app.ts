import cors from 'cors';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z, ZodError } from 'zod';
import {
  transactionIdSchema,
  overviewQuerySchema,
  transactionInputSchema,
  transactionPatchSchema,
  transactionQuerySchema,
} from './modules/transactions/transaction.schema.js';
import type { TransactionRepository } from './modules/transactions/transaction.repository.js';
import { accountInputSchema, transferInputSchema, transferQuerySchema } from './modules/accounts/account.schema.js';
import { AccountMissingError, DuplicateAccountNameError, type AccountRepository } from './modules/accounts/account.repository.js';
import { budgetIdSchema, budgetInputSchema, budgetPatchSchema, budgetQuerySchema } from './modules/budgets/budget.schema.js';
import { DuplicateBudgetError, type BudgetRepository } from './modules/budgets/budget.repository.js';
import { recurringIdSchema, recurringInputSchema, recurringQuerySchema, recurringToggleSchema } from './modules/recurring/recurring.schema.js';
import { utcToday } from './modules/recurring/schedule.js';
import type { RecurringRepository } from './modules/recurring/recurring.repository.js';
import { forecastRequestSchema } from './modules/forecast/forecast.schema.js';
import { buildForecast, forecastEndDate, forecastScenarioIsValid } from './modules/forecast/forecast.service.js';
import type { ForecastRepository } from './modules/forecast/forecast.repository.js';
import { analyticsQuerySchema } from './modules/analytics/analytics.schema.js';
import type { AnalyticsRepository } from './modules/analytics/analytics.repository.js';
import type { GuestSessions } from './security/guest-sessions.js';

type AppDependencies = { repository: TransactionRepository; accounts?: AccountRepository; budgets?: BudgetRepository; recurring?: RecurringRepository; forecast?: ForecastRepository; analytics?: AnalyticsRepository; guestSessions?: GuestSessions; now?: () => Date; clientOrigin: string; trustedProxies?: string };

const invalidInput = (error: ZodError) => ({
  error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', issues: z.treeifyError(error) },
});

const notFound = { error: { code: 'NOT_FOUND', message: 'Transaction not found' } };

export function createApp({ repository, accounts, budgets, recurring, forecast, analytics, guestSessions, now = () => new Date(), clientOrigin, trustedProxies }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  if (trustedProxies && trustedProxies !== 'direct') app.set('trust proxy', trustedProxies);
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: 'ok' });
  });

  if (guestSessions) {
    app.get('/api/session', guestSessions.bootstrap);
    app.use('/api', guestSessions.requireSession);
    app.post('/api/demo/reset', guestSessions.reset);
  }

  if (accounts) {
    app.get('/api/accounts', async (_request: Request, response: Response) => {
      response.json({ data: await accounts.list() });
    });

    app.post('/api/accounts', async (request: Request, response: Response) => {
      const parsed = accountInputSchema.safeParse(request.body);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      const account = await accounts.create(parsed.data);
      response.status(201).json({ data: account });
    });

    app.get('/api/transfers', async (request: Request, response: Response) => {
      const parsed = transferQuerySchema.safeParse(request.query);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      response.json({ data: await accounts.listTransfers(parsed.data.limit) });
    });

    app.post('/api/transfers', async (request: Request, response: Response) => {
      const parsed = transferInputSchema.safeParse(request.body);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      const transfer = await accounts.createTransfer(parsed.data);
      response.status(201).json({ data: transfer });
    });
  }

  if (budgets) {
    app.get('/api/budgets', async (request: Request, response: Response) => {
      const parsed = budgetQuerySchema.safeParse(request.query);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      response.json({ data: await budgets.overview(parsed.data.month) });
    });

    app.post('/api/budgets', async (request: Request, response: Response) => {
      const parsed = budgetInputSchema.safeParse(request.body);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      const budget = await budgets.create(parsed.data);
      response.status(201).location(`/api/budgets/${budget.id}`).json({ data: budget });
    });

    app.patch('/api/budgets/:id', async (request: Request, response: Response) => {
      const id = budgetIdSchema.safeParse(request.params.id);
      const patch = budgetPatchSchema.safeParse(request.body);
      if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
      if (!patch.success) { response.status(422).json(invalidInput(patch.error)); return; }
      if (!await budgets.update(id.data, patch.data)) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Budget not found' } });
        return;
      }
      response.status(204).send();
    });

    app.delete('/api/budgets/:id', async (request: Request, response: Response) => {
      const id = budgetIdSchema.safeParse(request.params.id);
      if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
      if (!await budgets.remove(id.data)) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Budget not found' } });
        return;
      }
      response.status(204).send();
    });
  }

  if (recurring) {
    app.get('/api/recurring', async (request: Request, response: Response) => {
      const parsed = recurringQuerySchema.safeParse(request.query);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      response.json({ data: await recurring.list(parsed.data.on) });
    });

    app.post('/api/recurring', async (request: Request, response: Response) => {
      const parsed = recurringInputSchema.safeParse(request.body);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      const record = await recurring.create(parsed.data);
      response.status(201).json({ data: record });
    });

    app.post('/api/recurring/apply', async (request: Request, response: Response) => {
      if (request.body && (typeof request.body !== 'object' || Object.keys(request.body).length > 0)) {
        response.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be empty' } });
        return;
      }
      response.json({ data: await recurring.applyDue(utcToday(now())) });
    });

    app.patch('/api/recurring/:id', async (request: Request, response: Response) => {
      const id = recurringIdSchema.safeParse(request.params.id);
      const toggle = recurringToggleSchema.safeParse(request.body);
      if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
      if (!toggle.success) { response.status(422).json(invalidInput(toggle.error)); return; }
      if (!await recurring.setEnabled(id.data, toggle.data.enabled)) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurring rule not found' } });
        return;
      }
      response.status(204).send();
    });
  }

  if (forecast) {
    // Read-only calculation: a scenario never inserts a real transaction.
    app.post('/api/forecast/simulate', async (request: Request, response: Response) => {
      const parsed = forecastRequestSchema.safeParse(request.body);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      const asOf = utcToday(now());
      if (!forecastScenarioIsValid(parsed.data, asOf)) {
        response.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Scenario date must be in the future and within the forecast period' } });
        return;
      }
      const snapshot = await forecast.readSnapshot(asOf, forecastEndDate(asOf, parsed.data.months));
      response.json({ data: buildForecast(snapshot, parsed.data, asOf) });
    });
  }

  if (analytics) {
    app.get('/api/analytics', async (request: Request, response: Response) => {
      const parsed = analyticsQuerySchema.safeParse(request.query);
      if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
      response.json({ data: await analytics.report(parsed.data) });
    });
  }

  app.get('/api/transactions', async (request: Request, response: Response) => {
    const parsed = transactionQuerySchema.safeParse(request.query);
    if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
    const page = await repository.list(parsed.data);
    response.json({ data: page.items, meta: { page: parsed.data.page, limit: parsed.data.limit, total: page.total, totals: page.totals } });
  });

  app.get('/api/transactions/overview', async (request: Request, response: Response) => {
    const parsed = overviewQuerySchema.safeParse(request.query);
    if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
    const { month, currentMonth } = parsed.data;
    const year = Number(currentMonth.slice(0, 4));
    const monthNumber = Number(currentMonth.slice(5, 7));
    const chartMonths = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(year, monthNumber - 6 + index, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    response.json({ data: await repository.overview(month, chartMonths) });
  });

  app.get('/api/transactions/:id', async (request: Request, response: Response) => {
    const id = transactionIdSchema.safeParse(request.params.id);
    if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
    const transaction = await repository.findById(id.data);
    if (!transaction) { response.status(404).json(notFound); return; }
    response.json({ data: transaction });
  });

  app.post('/api/transactions', async (request: Request, response: Response) => {
    const parsed = transactionInputSchema.safeParse(request.body);
    if (!parsed.success) { response.status(422).json(invalidInput(parsed.error)); return; }
    const transaction = await repository.create(parsed.data);
    response.status(201).location(`/api/transactions/${transaction.id}`).json({ data: transaction });
  });

  app.patch('/api/transactions/:id', async (request: Request, response: Response) => {
    const id = transactionIdSchema.safeParse(request.params.id);
    if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
    const patch = transactionPatchSchema.safeParse(request.body);
    if (!patch.success) { response.status(422).json(invalidInput(patch.error)); return; }
    const previous = await repository.findById(id.data);
    if (!previous) { response.status(404).json(notFound); return; }
    const { id: _existingId, ...existingFields } = previous;
    const merged = transactionInputSchema.safeParse({ ...existingFields, ...patch.data });
    if (!merged.success) { response.status(422).json(invalidInput(merged.error)); return; }
    const transaction = await repository.update(id.data, merged.data);
    if (!transaction) { response.status(404).json(notFound); return; }
    response.json({ data: transaction });
  });

  app.delete('/api/transactions/:id', async (request: Request, response: Response) => {
    const id = transactionIdSchema.safeParse(request.params.id);
    if (!id.success) { response.status(422).json(invalidInput(id.error)); return; }
    if (!(await repository.remove(id.data))) { response.status(404).json(notFound); return; }
    response.status(204).send();
  });

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
      return;
    }
    if (error instanceof AccountMissingError) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
      return;
    }
    if (error instanceof DuplicateBudgetError) {
      response.status(409).json({ error: { code: 'CONFLICT', message: 'Budget already exists for this month and category' } });
      return;
    }
    if (error instanceof DuplicateAccountNameError) {
      response.status(409).json({ error: { code: 'CONFLICT', message: 'Account name already exists' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503') {
      response.status(422).json({ error: { code: 'INVALID_ACCOUNT', message: 'Account does not exist' } });
      return;
    }
    console.error('Unhandled API error:', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errorHandler);
  return app;
}
