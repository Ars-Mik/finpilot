import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checksumForMigration, matchesMigrationChecksum } from '../src/db/migration-checksum.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('migration checksums', () => {
  const sqlLf = 'CREATE TABLE example (id int);\n-- sample\n';
  const sqlCrlf = sqlLf.replace(/\n/g, '\r\n');

  it('stores the same checksum for LF and CRLF files', () => {
    expect(checksumForMigration(sqlLf)).toBe(checksumForMigration(sqlCrlf));
  });

  it('accepts historical checksums recorded with either line ending', () => {
    expect(matchesMigrationChecksum(sqlLf, hash(sqlCrlf))).toBe(true);
    expect(matchesMigrationChecksum(sqlCrlf, hash(sqlLf))).toBe(true);
  });

  it('rejects actual migration changes', () => {
    const updated = sqlLf.replace('id int', 'id bigint');
    expect(matchesMigrationChecksum(updated, hash(sqlLf))).toBe(false);
    expect(matchesMigrationChecksum(updated, hash(sqlCrlf))).toBe(false);
  });
});
