# EdificARTE

EdificARTE is a worldwide gamified audioguide and geo-localized exploration web app for landmarks, museums, temples, parks, viewpoints and archaeological sites. Powered by Mapbox GL JS for cartography and Cloudflare Workers for edge runtime, EdificARTE is built to scale from a single city to the entire planet.

The catalog grows from the [legacy CDMX seed](./src/data/monuments.ts) and is designed to be expanded via an admin panel backed by Supabase + PostGIS (see [`supabase/schema.sql`](./supabase/schema.sql)). The UI ships bilingual (Spanish + English) from day one with a header language switcher.

---

## Tech Stack

- **Framework**: [Astro](https://astro.build/) 5.x configured in `output: "server"` mode for continuous SSR.
- **Edge runtime**: [Cloudflare Pages & Workers](https://workers.cloudflare.com/) via the official `@astrojs/cloudflare` adapter.
- **Map**: [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) — vector tiles, search, and proximity queries.
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) 3.x with class-based dark mode.
- **Type safety**: TypeScript in strict mode.
- **Storage (current scaffold)**:
  - **D1** (Cloudflare SQLite): legacy scaffold, will be retired.
  - **R2 Bucket**: S3-compatible storage for audio files.
  - **KV Namespace**: high-perf cache + ephemeral session storage.
- **Storage (target — Slice 2+)**:
  - **Supabase / Postgres + PostGIS**: multi-city catalog with geo queries and JSONB translations. Schema in [`supabase/schema.sql`](./supabase/schema.sql). See also [`src/lib/supabase.ts`](./src/lib/supabase.ts).
- **Package manager**: `pnpm`.

---

## Smart Contracts (Polygon Mainnet)

The on-chain layer runs on Polygon (chainId 137). Verify transactions and source on PolygonScan:

- **Badge Contract (Insignias / POAPs)**: [`0xF3BFe6Fac28Fa7E17280fd74e9C52294686a5F25`](https://polygonscan.com/address/0xF3BFe6Fac28Fa7E17280fd74e9C52294686a5F25)
- **Review Contract (On-Chain Reviews)**: [`0x993362db73F57f3CbEBD310b31E42Bb21ED27538`](https://polygonscan.com/address/0x993362db73F57f3CbEBD310b31E42Bb21ED27538)
- **USDC Contract (Native Polygon)**: [`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`](https://polygonscan.com/address/0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)

---

## Quickstart

### 1. Install

Requires Node.js 22.18 or newer in the Node 22 line (`.nvmrc` selects Node 22) and `pnpm`:

```bash
pnpm install
```

### 2. Run dev server

```bash
pnpm dev
```

App is served at `http://localhost:4321`.

### 3. Generate Cloudflare binding types

```bash
pnpm wrangler:types
```

This writes `worker-configuration.d.ts` so TypeScript recognizes the runtime env.

---

## Scripts

| Script                                       | Purpose                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev` / `pnpm start`                    | Local Astro dev server (`localhost:4321`).                          |
| `pnpm build`                                 | Production build to `dist/`.                                        |
| `pnpm preview`                               | Local Cloudflare simulation of `dist/` via Wrangler.                |
| `pnpm test`                                  | Run Node 22 application unit tests once with Vitest.                |
| `pnpm test:phase-zero`                       | Validate passing and fail-closed Phase-0 evidence fixtures.         |
| `pnpm verify:phase-zero -- <receipt> <root>` | Verify a receipt against a read-only evidence root.                 |
| `pnpm lint`                                  | ESLint + Prettier check across the repo.                            |
| `pnpm format`                                | Auto-format with Prettier.                                          |
| `pnpm typecheck`                             | `astro check` + `tsc --noEmit`.                                     |
| `pnpm wrangler:types`                        | Generate Cloudflare binding types.                                  |
| `pnpm supabase:local:start`                  | Start the isolated local Supabase stack (Docker required).          |
| `pnpm supabase:local:status`                 | Inspect local Supabase containers without linking a remote project. |
| `pnpm supabase:local:stop`                   | Stop the isolated local Supabase stack.                             |

---

## Internationalization

EdificARTE ships bilingual Spanish (default) + English.

- Strings live in [`src/i18n/es.json`](./src/i18n/es.json) and [`src/i18n/en.json`](./src/i18n/en.json).
- The `<LocaleSwitcher />` component in the header persists the choice via `localStorage['edificarte_locale']` and updates `document.documentElement.lang` on toggle.
- Server-rendered HTML is generated in the default locale; the client applies the user's choice on mount.
- URL param `?lang=en` forces a locale for shareable links.
- Data layer (monuments, tours) carries its own `translations` field — see [`pickLocalized()`](./src/lib/i18n.ts).

To add a third locale:

1. Add `src/i18n/<locale>.json`.
2. Add the entry to `SUPPORTED_LOCALES` and the `DICTS` map in [`src/components/LocaleSwitcher.astro`](./src/components/LocaleSwitcher.astro).
3. Add translations to data entities in `src/data/*.ts`.

---

## Design System

Modern, Mapbox-inspired aesthetic — sober slate background with a saturated blue accent. **No purple / violet / indigo anywhere**.

- `brand-*` → slate scale (`#f8fafc` → `#020617`).
- `accent-*` → Mapbox blue (`#eff6ff` → `#172554`).
- Dark mode uses slate-950 backgrounds with the same accent palette.
- Custom shadow recipes in [`src/styles/global.css`](./src/styles/global.css) are aligned to the same accent.

---

## Roadmap

| Slice | Status     | Scope                                                                                                 |
| ----- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 1     | ✅ Current | Worldwide UI scaffold, bilingual, Mapbox map, single-city seed.                                       |
| 2     | 🔲 Planned | Supabase migration. Admin panel for catalog contributors. Multi-city seed. PostGIS proximity queries. |
| 3     | 🔲 Planned | Async onboarding for native speakers (audio guides in multiple languages per monument).               |
| 4     | 🔲 Planned | On-chain reputation (Badges + Reviews) fully wired to Supabase events log.                            |

---

## Testing Status

> **CURRENT MODE: Standard Mode** — Node 22 Vitest application tests are available.
>
> Tests use Vitest's Node environment because Vercel SSR is the configured runtime. Cloudflare's worker pool is intentionally not used. Add behavior-first tests with each new unit; Strict TDD is not enabled.

Phase-0 templates and an explicitly non-approved specimen live in [`migration-evidence`](./migration-evidence). Generate real receipts and artifacts only under ignored output/backup paths. `pnpm verify:phase-zero -- <receipt.json> <evidence-root> <trusted-public-key.pem> [expected-key-id]` reads actual NDJSON bytes, rejects paths or symlinks outside the root, verifies SHA-256 and inventory/export/backup/restore counts, and emits deterministic JSON with a nonzero exit on any unproven condition. Counts mean nonblank, valid NDJSON records; every source inventory entry requires exactly one export. Export and backup records must have the same multiset of recursively key-sorted canonical JSON values, including duplicates; record and object-key order do not matter. Approval requires an Ed25519 signature over the verified evidence digest and all approval metadata. The verifier trusts only the explicitly supplied public key; it never signs or accepts a receipt-embedded key. Illustrative receipts always fail.

The checked-in [`supabase/config.toml`](./supabase/config.toml) is local-only. Do not run `supabase link`, and do not copy the broken legacy `supabase/schema.sql` into migrations. Local reset currently creates no domain schema.

---

## Decisions

1. **Output `server`**: SSR per-request so we can read Cloudflare bindings at runtime.
2. **Wrangler JSONC**: modern format with comments + strict JSON, declared bindings.
3. **Bindings**:
   - `DB` → D1 (legacy, will migrate).
   - `ASSETS` → R2 (audio files).
   - `CACHE` → KV (high-perf cache).
   - `SESSION` → KV (ephemeral guest session).
4. **Supabase scaffold in place**: `src/lib/supabase.ts` returns `null` when env vars are absent, so D1 fallback works until the migration runs.
