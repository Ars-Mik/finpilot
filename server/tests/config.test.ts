import { describe, expect, it } from 'vitest';
import { loadAdminConfig, loadRuntimeConfig } from '../src/config.js';

const runtime = {
  NODE_ENV: 'production',
  APP_DATABASE_URL: 'postgresql://finpilot_app:password@127.0.0.1:5432/finpilot',
  CLIENT_ORIGIN: 'https://finpilot.example',
  SESSION_SECRET: 'a'.repeat(64),
  TRUSTED_PROXY_CIDRS: 'loopback',
};

describe('production configuration separation', () => {
  it('runs the web API without privileged database credentials', () => {
    const config = loadRuntimeConfig(runtime);
    expect(config.APP_DATABASE_URL).toContain('finpilot_app');
    expect('DATABASE_URL' in config).toBe(false);
  });

  it('requires an admin connection for migration and cleanup commands', () => {
    expect(() => loadAdminConfig(runtime)).toThrow('Invalid database maintenance configuration');
    expect(loadAdminConfig({ ...runtime,
      DATABASE_URL: 'postgresql://finpilot_admin:password@127.0.0.1:5432/finpilot',
    }).DATABASE_URL).toContain('finpilot_admin');
    expect(() => loadAdminConfig({ ...runtime,
      DATABASE_URL: runtime.APP_DATABASE_URL,
    })).toThrow('dedicated non-admin');
  });

  it('requires a random-looking secret, HTTPS and explicit trusted-proxy setting', () => {
    expect(() => loadRuntimeConfig({ ...runtime, SESSION_SECRET: 'development-only-secret'.repeat(4) }))
      .toThrow('32-byte hex');
    expect(() => loadRuntimeConfig({ ...runtime, CLIENT_ORIGIN: 'http://finpilot.example' }))
      .toThrow('HTTPS');
    expect(() => loadRuntimeConfig({ ...runtime, TRUSTED_PROXY_CIDRS: undefined }))
      .toThrow('TRUSTED_PROXY_CIDRS is required');
    expect(() => loadRuntimeConfig({ ...runtime, TRUSTED_PROXY_CIDRS: 'true' }))
      .toThrow('specific trusted addresses');
    expect(() => loadRuntimeConfig({ ...runtime, TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }))
      .toThrow('specific trusted addresses');
    expect(loadRuntimeConfig({ ...runtime, TRUSTED_PROXY_CIDRS: 'direct' }).TRUSTED_PROXY_CIDRS)
      .toBe('direct');
  });

  it('requires CLIENT_ORIGIN to be exactly an origin, not a URL path', () => {
    expect(() => loadRuntimeConfig({ ...runtime, CLIENT_ORIGIN: 'https://finpilot.example/app' }))
      .toThrow('single origin');
  });
});
