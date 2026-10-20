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

type AppDependencies = { repository: TransactionRepository; clientOrigin: string };

const invalidInput = (error: ZodError) => ({
  error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', issues: z.treeifyError(error) },
});

const notFound = { error: { code: 'NOT_FOUND', message: 'Transaction not found' } };

export function createApp({ repository, clientOrigin }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: 'ok' });
  });

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
    console.error('Unhandled API error:', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errorHandler);
  return app;
}
