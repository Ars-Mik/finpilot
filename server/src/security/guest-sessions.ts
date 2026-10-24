import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Request, Response } from 'express';
import type { Pool } from 'pg';
import { inWorkspace } from './workspace-db.js';
import { seedDemo } from '../modules/demo/seed.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_DEV = 'finpilot_guest';
const COOKIE_SECURE = '__Host-finpilot_guest';
const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type SessionRow = { workspaceId: string };
type Session = { workspaceId: string; csrfToken: string };

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookies(request: Request): Map<string, string> {
  return new Map((request.headers.cookie ?? '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class GuestSessions {
  private readonly attempts = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly pool: Pool,
    private readonly scopedPool: Pool,
    private readonly secret: string,
    private readonly origin: string,
    private readonly secure: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get cookieName(): string { return this.secure ? COOKIE_SECURE : COOKIE_DEV; }

  private csrf(token: string): string {
    return createHmac('sha256', this.secret).update(`finpilot-csrf:${token}`).digest('hex');
  }

  private async read(request: Request): Promise<Session | null> {
    const token = cookies(request).get(this.cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const result = await this.pool.query<SessionRow>(
      `SELECT workspace_id AS "workspaceId" FROM guest_sessions
       WHERE token_hash = $1 AND expires_at > NOW()`, [tokenHash(token)],
    );
    return result.rows[0] ? { workspaceId: result.rows[0].workspaceId, csrfToken: this.csrf(token) } : null;
  }

  private permitCreation(request: Request): boolean {
    const ip = request.ip ?? 'unknown';
    const now = this.now().getTime();
    if (this.attempts.size > 5000) this.attempts.clear();
    const bucket = this.attempts.get(ip);
    if (!bucket || bucket.until < now) {
      this.attempts.set(ip, { count: 1, until: now + 3600000 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= 10;
  }

  readonly bootstrap: RequestHandler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.origin && request.headers.origin !== this.origin) {
      response.status(403).json({ error: { code: 'ORIGIN_DENIED', message: 'Unexpected request origin' } });
      return;
    }
    const existing = await this.read(request);
    if (existing) {
      response.json({ data: { csrfToken: existing.csrfToken, mode: 'guest' } });
      return;
    }
    if (!this.permitCreation(request)) {
      response.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many demo sessions from this address' } });
      return;
    }
    const token = randomBytes(32).toString('hex');
    const workspaceId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO workspaces (id, kind) VALUES ($1, $2)', [workspaceId, 'guest']);
      await client.query("SELECT set_config('finpilot.workspace_id', $1, true)", [workspaceId]);
      await seedDemo(client, this.now());
      await client.query(
        `INSERT INTO guest_sessions (token_hash, workspace_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`, [tokenHash(token), workspaceId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    response.cookie(this.cookieName, token, {
      httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/', maxAge: SESSION_MS,
    });
    response.status(201).json({ data: { csrfToken: this.csrf(token), mode: 'guest' } });
  };

  readonly requireSession: RequestHandler = async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const session = await this.read(request);
    if (!session) {
      response.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Guest session missing or expired. Reload the page.' } });
      return;
    }
    if (mutations.has(request.method)) {
      const csrf = request.get('X-FinPilot-CSRF') ?? '';
      if (!tokenEquals(csrf, session.csrfToken) || (request.headers.origin && request.headers.origin !== this.origin)) {
        response.status(403).json({ error: { code: 'CSRF_DENIED', message: 'Invalid request token or origin' } });
        return;
      }
    }
    inWorkspace(session.workspaceId, next);
  };

  readonly reset: RequestHandler = async (_request: Request, response: Response) => {
    const client = await this.scopedPool.connect();
    try {
      await client.query('BEGIN');
      for (const table of ['transactions', 'account_transfers', 'recurring_rules', 'monthly_budgets', 'accounts']) {
        await client.query(`DELETE FROM ${table}`);
      }
      await seedDemo(client, this.now());
      await client.query('COMMIT');
      response.json({ data: { reset: true } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
}
