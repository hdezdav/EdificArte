import { defineMiddleware } from 'astro:middleware';
import productsData from './data/tianquiztlis_products.json';
import { TOURS } from './data/tours';
import { createRequestId, resolveAdminRequestContext, validateCsrf, validateSameOrigin } from './lib/admin';

let dbInstance: any = null;

function getLocalDb() {
  if (dbInstance) return dbInstance;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const fs = require('node:fs');
    const path = require('node:path');

    const devVarsPath = path.join(process.cwd(), '.dev.vars');
    if (fs.existsSync(devVarsPath)) {
      const content = fs.readFileSync(devVarsPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (key && !(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      }
    }

    const dbDir = path.join(process.cwd(), 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'local.db');
    dbInstance = new DatabaseSync(dbPath);

    dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      points INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      visits INTEGER DEFAULT 0,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT,
      badge_id INTEGER,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      tx_hash TEXT,
      PRIMARY KEY (user_id, badge_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      text TEXT,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_wallets (
      user_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      chain_id INTEGER DEFAULT 137,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(address);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      wallet_address TEXT NOT NULL,
      tx_hash TEXT UNIQUE NOT NULL,
      total_usdc TEXT NOT NULL,
      items_json TEXT NOT NULL,
      status TEXT DEFAULT 'paid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_tx ON orders(tx_hash);

    CREATE TABLE IF NOT EXISTS kv_sessions (
      key TEXT PRIMARY KEY,
      value TEXT,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sku TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'MXN',
      category TEXT,
      origin TEXT,
      country_code TEXT,
      images TEXT,
      file TEXT,
      is_published INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tours (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      duration TEXT,
      price_per_person INTEGER NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'MXN',
      image TEXT,
      highlights TEXT,
      description TEXT,
      meeting_point TEXT,
      city TEXT,
      country TEXT,
      country_code TEXT,
      guide TEXT,
      category TEXT DEFAULT 'tour',
      translations TEXT,
      is_published INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Additive compatibility migration for existing local/Vercel SQLite files.
  // It is intentionally idempotent and does not rewrite or drop legacy data.
  for (const statement of [
    'ALTER TABLE products ADD COLUMN country_code TEXT',
    'ALTER TABLE tours ADD COLUMN country_code TEXT',
  ]) {
    try { dbInstance.exec(statement); } catch (error) {
      if (!String(error).toLowerCase().includes('duplicate column')) console.warn('[Middleware] country migration skipped:', error);
    }
  }

  // Compatibility backfill is deliberately conservative: only the existing
  // Mexico seed/legacy mappings are classified. Unknown values remain NULL and
  // therefore cannot become eligible for a country-aware read accidentally.
  try {
    dbInstance.exec("UPDATE tours SET country_code = 'MX' WHERE country_code IS NULL AND upper(trim(country)) IN ('MX', 'MEXICO', 'MÉXICO')");
    dbInstance.exec("UPDATE products SET country_code = 'MX' WHERE country_code IS NULL AND upper(trim(origin)) IN ('MX', 'MEXICO', 'MÉXICO')");
    dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_tours_published_country ON tours(country_code, created_at DESC) WHERE is_published = 1');
    dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_products_published_country ON products(country_code, created_at DESC) WHERE is_published = 1');
  } catch (error) {
    console.warn('[Middleware] country backfill/index skipped:', error);
  }

  // Seed managed content from static files (idempotent; only when tables are empty).
  // Static files remain the seed source; consumers read from the DB after migration.
  try {
    type ProductSeed = {
      name?: string; description?: string; sku?: string; price?: number;
      currency?: string; category?: string; origin?: string; images?: string[]; file?: string;
    };
    const pCount = dbInstance.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number } | undefined;
    if ((pCount?.c ?? 0) === 0 && Array.isArray(productsData)) {
      const pStmt = dbInstance.prepare(
        'INSERT OR IGNORE INTO products (id, name, description, sku, price, currency, category, origin, images, file, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
      );
      (productsData as ProductSeed[]).forEach((p, i) => {
        pStmt.run(
          `prod-${i}`,
          p.name ?? '',
          p.description ?? '',
          p.sku ?? '',
          p.price ?? 0,
          p.currency ?? 'MXN',
          p.category ?? '',
          p.origin ?? '',
          JSON.stringify(p.images ?? []),
          p.file ?? ''
        );
      });
    }

    const tCount = dbInstance.prepare('SELECT COUNT(*) as c FROM tours').get() as { c: number } | undefined;
    if ((tCount?.c ?? 0) === 0 && TOURS.length > 0) {
      const tStmt = dbInstance.prepare(
        'INSERT OR IGNORE INTO tours (id, title, subtitle, duration, price_per_person, currency, image, highlights, description, meeting_point, city, country, guide, category, translations, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
      );
      for (const t of TOURS) {
        tStmt.run(
          t.id,
          t.title,
          t.subtitle ?? '',
          t.duration,
          t.pricePerPerson,
          t.currency,
          t.image,
          JSON.stringify(t.highlights),
          t.description,
          t.meetingPoint,
          t.city,
          t.country,
          JSON.stringify(t.guide),
          t.category,
          JSON.stringify(t.translations ?? {})
        );
      }
    }
  } catch (seedErr) {
    console.warn('[Middleware] Content seed failed:', seedErr);
  }
  } catch (err) {
    console.error('[Middleware] Database initialization failed:', err);
  }
  return dbInstance;
}

// D1 Database Mock Wrapper
class D1PreparedStatementMock {
  private stmt: any;
  private boundValues: unknown[] = [];

  constructor(stmt: any) {
    this.stmt = stmt;
  }

  bind(...values: unknown[]) {
    // Normalize boolean values to 1/0 for SQLite
    this.boundValues = values.map(val => (typeof val === 'boolean' ? (val ? 1 : 0) : val));
    return this;
  }

  async all() {
    try {
      const results = this.stmt.all(...(this.boundValues as (string | number | bigint | Uint8Array | null)[]));
      return { results, success: true };
    } catch (err) {
      console.error('[D1 Mock] Statement execution failed:', err);
      throw err;
    }
  }

  async first() {
    try {
      const row = this.stmt.get(...(this.boundValues as (string | number | bigint | Uint8Array | null)[]));
      return row === undefined ? null : row;
    } catch (err) {
      console.error('[D1 Mock] Statement execution failed:', err);
      throw err;
    }
  }

  async run() {
    try {
      this.stmt.run(...(this.boundValues as (string | number | bigint | Uint8Array | null)[]));
      return { success: true };
    } catch (err) {
      console.error('[D1 Mock] Statement execution failed:', err);
      throw err;
    }
  }
}

class D1DatabaseMock {
  prepare(sql: string) {
    try {
      // D1 DB prepare mapping
      const stmt = getLocalDb().prepare(sql);
      return new D1PreparedStatementMock(stmt);
    } catch (err) {
      console.error('[D1 Mock] Query compilation failed for SQL:', sql, err);
      throw err;
    }
  }
}

// KV Session Mock Wrapper
const sessionKVMock = {
  async get(key: string): Promise<string | null> {
    try {
      const stmt = getLocalDb().prepare('SELECT value FROM kv_sessions WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)');
      const row = stmt.get(key, Math.floor(Date.now() / 1000)) as { value: string } | undefined;
      return row ? row.value : null;
    } catch (err) {
      console.error('[KV Mock] GET failed:', err);
      return null;
    }
  },

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    try {
      const expiresAt = options?.expirationTtl ? Math.floor(Date.now() / 1000 + options.expirationTtl) : null;
      const stmt = getLocalDb().prepare('INSERT OR REPLACE INTO kv_sessions (key, value, expires_at) VALUES (?, ?, ?)');
      stmt.run(key, value, expiresAt);
    } catch (err) {
      console.error('[KV Mock] PUT failed:', err);
    }
  },

  async delete(key: string): Promise<void> {
    try {
      const stmt = getLocalDb().prepare('DELETE FROM kv_sessions WHERE key = ?');
      stmt.run(key);
    } catch (err) {
      console.error('[KV Mock] DELETE failed:', err);
    }
  }
};

const cacheKVMock = {
  async get(_key: string) { return null; },
  async put(_key: string, _value: string) {},
  async delete(_key: string) {}
};

export const onRequest = defineMiddleware(async (context, next) => {
  // If we are not on Cloudflare (Astro.locals.runtime is missing), inject mock env
  if (!context.locals.runtime) {
    const mockEnv: Env = {
      DB: new D1DatabaseMock() as unknown as Env['DB'],
      SESSION: sessionKVMock as unknown as Env['SESSION'],
      CACHE: cacheKVMock as unknown as Env['CACHE'],
      
      // Load standard process environment variables
      USDC_CONTRACT_ADDRESS: process.env.USDC_CONTRACT_ADDRESS || '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      POLYGON_RPC_URL: process.env.POLYGON_RPC_URL || '',
      PUBLIC_BADGE_CONTRACT_ADDRESS: process.env.PUBLIC_BADGE_CONTRACT_ADDRESS || '',
      PUBLIC_REVIEW_CONTRACT_ADDRESS: process.env.PUBLIC_REVIEW_CONTRACT_ADDRESS || '',
      EDIFICARTE_PAYMENT_ADDRESS: process.env.EDIFICARTE_PAYMENT_ADDRESS || process.env.TURIMAP_PAYMENT_ADDRESS || '',
      TURIMAP_PAYMENT_ADDRESS: process.env.EDIFICARTE_PAYMENT_ADDRESS || process.env.TURIMAP_PAYMENT_ADDRESS || '',
      EDIFICARTE_DONATION_ADDRESS: process.env.EDIFICARTE_DONATION_ADDRESS || process.env.TURIMAP_DONATION_ADDRESS || '',
      TURIMAP_DONATION_ADDRESS: process.env.EDIFICARTE_DONATION_ADDRESS || process.env.TURIMAP_DONATION_ADDRESS || '',
      ADMIN_PRIVATE_KEY: process.env.ADMIN_PRIVATE_KEY || '',
      ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || '',
      GROK_API_KEY: process.env.GROK_API_KEY || '',
      ALCHEMY_KEY: process.env.ALCHEMY_KEY || '',
      MAPBOX_TOKEN: process.env.MAPBOX_TOKEN || '',
    };

    context.locals.runtime = {
      env: mockEnv,
      cf: {} as unknown as App.Locals['runtime']['cf'],
      caches: {} as unknown as App.Locals['runtime']['caches'],
      ctx: {} as unknown as App.Locals['runtime']['ctx']
    };
  }

  const { env } = context.locals.runtime;
  context.locals.requestId = createRequestId();
  const auth = await resolveAdminRequestContext(env, context.cookies, import.meta.env.PROD);
  context.locals.user = auth.user;
  context.locals.actorId = auth.user?.id || null;
  context.locals.adminAuthorized = auth.authorized;
  context.locals.csrfToken = auth.csrfToken;
  const pathname = new URL(context.request.url).pathname;
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method);
  if (pathname.startsWith('/api/admin/') && unsafe && !validateSameOrigin(context.request)) {
    return new Response(JSON.stringify({ ok: false, error: 'Solicitud no válida' }), { status: 403 });
  }
  if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login' && unsafe && !validateCsrf(context.request, auth.csrfToken)) {
    return new Response(JSON.stringify({ ok: false, error: 'Solicitud no válida' }), { status: 403 });
  }
  return await next();
});
