import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AccountMissingError, DuplicateAccountNameError, type AccountRepository } from '../src/modules/accounts/account.repository.js';
import type { Account, AccountInput, AccountTransfer, TransferInput } from '../src/modules/accounts/account.schema.js';
import type { TransactionRepository } from '../src/modules/transactions/transaction.repository.js';

const missingTransactions: TransactionRepository = {
  async list() { throw new Error('Not used'); }, async overview() { throw new Error('Not used'); },
  async findById() { throw new Error('Not used'); }, async create() { throw new Error('Not used'); },
  async update() { throw new Error('Not used'); }, async remove() { throw new Error('Not used'); },
};

class FakeAccounts implements AccountRepository {
  accounts: Account[] = [{ id: randomUUID(), name: 'Основной', kind: 'checking', openingBalanceCents: 200_00, balanceCents: 200_00 }];
  transfers: AccountTransfer[] = [];

  async list() { return this.accounts; }
  async create(input: AccountInput) {
    if (this.accounts.some((account) => account.name.toLowerCase() === input.name.toLowerCase())) {
      throw new DuplicateAccountNameError();
    }
    const account = { id: randomUUID(), ...input, balanceCents: input.openingBalanceCents };
    this.accounts.push(account);
    return account;
  }
  async listTransfers(limit: number) { return this.transfers.slice(-limit).toReversed(); }
  async createTransfer(input: TransferInput) {
    const from = this.accounts.find((account) => account.id === input.fromAccountId);
    const to = this.accounts.find((account) => account.id === input.toAccountId);
    if (!from || !to) throw new AccountMissingError();
    const transfer = { id: randomUUID(), ...input };
    from.balanceCents -= input.amountCents;
    to.balanceCents += input.amountCents;
    this.transfers.push(transfer);
    return transfer;
  }
}

function setup() {
  const accounts = new FakeAccounts();
  return { accounts, app: createApp({ repository: missingTransactions, accounts, clientOrigin: 'http://localhost:5173' }) };
}

describe('accounts API', () => {
  it('lists the default account and creates a savings account', async () => {
    const { app } = setup();
    const initial = await request(app).get('/api/accounts');
    expect(initial.status).toBe(200);
    expect(initial.body.data).toHaveLength(1);
    const created = await request(app).post('/api/accounts').send({ name: 'Сбережения', kind: 'savings', openingBalanceCents: 500_00 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Сбережения', balanceCents: 500_00 });
    expect((await request(app).get('/api/accounts')).body.data).toHaveLength(2);
  });

  it('validates account values and rejects duplicate names', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/accounts').send({ name: 'Основной', kind: 'checking' })).status).toBe(409);
    expect((await request(app).post('/api/accounts').send({ name: 'Тест', kind: 'crypto' })).status).toBe(422);
    expect((await request(app).post('/api/accounts').send({ name: 'Тест', kind: 'cash', openingBalanceCents: -1 })).status).toBe(422);
    expect((await request(app).post('/api/accounts').send({ name: 'Тест', kind: 'cash', secret: true })).status).toBe(422);
  });

  it('moves money between accounts while preserving the combined balance', async () => {
    const { app, accounts } = setup();
    const target = (await request(app).post('/api/accounts').send({ name: 'Наличные', kind: 'cash' })).body.data.id as string;
    const source = accounts.accounts[0]!.id;
    const transfer = await request(app).post('/api/transfers').send({ fromAccountId: source, toAccountId: target, amountCents: 50_00, date: '2026-10-20' });
    expect(transfer.status).toBe(201);
    const after = (await request(app).get('/api/accounts')).body.data as Account[];
    expect(after.find((account) => account.id === source)?.balanceCents).toBe(150_00);
    expect(after.find((account) => account.id === target)?.balanceCents).toBe(50_00);
    expect(after.reduce((sum, account) => sum + account.balanceCents, 0)).toBe(200_00);
    expect((await request(app).get('/api/transfers')).body.data).toHaveLength(1);
  });

  it('rejects invalid, self and unknown-account transfers', async () => {
    const { app, accounts } = setup();
    const source = accounts.accounts[0]!.id;
    for (const payload of [
      { fromAccountId: source, toAccountId: source, amountCents: 100, date: '2026-10-20' },
      { fromAccountId: source, toAccountId: randomUUID(), amountCents: 0, date: '2026-10-20' },
      { fromAccountId: source, toAccountId: randomUUID(), amountCents: 50, date: '2026-02-30' },
    ]) expect((await request(app).post('/api/transfers').send(payload)).status).toBe(422);
    expect((await request(app).post('/api/transfers').send({ fromAccountId: source, toAccountId: randomUUID(), amountCents: 100, date: '2026-10-20' })).status).toBe(404);
  });

  it('validates history query parameters', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/transfers?limit=101')).status).toBe(422);
    expect((await request(app).get('/api/transfers?userId=123')).status).toBe(422);
  });
});
