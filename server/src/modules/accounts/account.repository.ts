import type { Account, AccountInput, AccountTransfer, TransferInput } from './account.schema.js';

export class DuplicateAccountNameError extends Error {}
export class AccountMissingError extends Error {}

export interface AccountRepository {
  list(): Promise<Account[]>;
  create(input: AccountInput): Promise<Account>;
  listTransfers(limit: number): Promise<AccountTransfer[]>;
  createTransfer(input: TransferInput): Promise<AccountTransfer>;
}
