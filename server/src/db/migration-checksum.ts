import { createHash } from 'node:crypto';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLineEndings(sql: string): string {
  return sql.replace(/\r\n/g, '\n');
}

export function checksumForMigration(sql: string): string {
  return sha256(normalizeLineEndings(sql));
}

export function matchesMigrationChecksum(sql: string, recorded: string): boolean {
  const normalized = normalizeLineEndings(sql);
  // Older migrations were hashed using the checkout's native line endings.
  return recorded === sha256(sql)
    || recorded === sha256(normalized)
    || recorded === sha256(normalized.replace(/\n/g, '\r\n'));
}
