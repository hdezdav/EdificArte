-- Schema para EdificARTE: Usuarios, Insignias, Reviews, Wallets

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
  tx_hash TEXT,                     -- hash de la tx on-chain (mock o live)
  PRIMARY KEY (user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reviews dejadas por usuarios autenticados. Otorgan 5 puntos al autor
-- y emiten un evento on-chain (mock o live según env vars).
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,        -- 'museum' | 'product' | 'tour'
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  text TEXT,
  tx_hash TEXT,                     -- hash de la tx on-chain (mock o live)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id, created_at DESC);

-- Wallets conectadas por usuarios (para enviar NFTs + recibir pagos USDC).
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  chain_id INTEGER DEFAULT 137,     -- Polygon mainnet por default
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Una wallet solo puede estar asociada a UN user (previene que 2 users
-- distintos se identifiquen con la misma address y dividan sus puntos/badges
-- en D1 mientras gastan USDC desde la misma wallet on-chain).
-- Aplicar también en prod con:
--   pnpm wrangler d1 execute edificarte-db --file db/schema.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_address
ON user_wallets(address);

-- Órdenes de compra de artesanías pagadas en USDC. La fuente de verdad
-- del pago es la tx on-chain (validada en /api/orders); esta tabla solo
-- registra el linkage entre la tx y los items.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT,                     -- NULL si el comprador era guest
  wallet_address TEXT NOT NULL,
  tx_hash TEXT UNIQUE NOT NULL,     -- tx de USDC en Polygon
  total_usdc TEXT NOT NULL,         -- en formato raw (6 decimales)
  items_json TEXT NOT NULL,         -- JSON con [{sku, name, qty, priceMXN, priceUSDC}]
  status TEXT DEFAULT 'paid',       -- 'paid' | 'shipped' | 'cancelled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tx ON orders(tx_hash);
