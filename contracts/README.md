# Contratos EdificARTE

Estos son los contratos Solidity para los features on-chain de EdificARTE. **No están deployados** — el código está listo para que vos los deployes cuando quieras usando Hardhat (recomendado) o Foundry.

## Contratos

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `EdificARteBadge.sol` | ERC-721 | NFTs de medallas por visitar monumentos |
| `EdificARteReviews.sol` | Event emitter | Registro público de reviews |

## Dependencias

Ambos contratos dependen de OpenZeppelin Contracts **v5.1.0** (pinneado en `contracts/package.json`). No usar 4.x — los contratos usan `Ownable(initialOwner)` que es el patrón nuevo de v5.

## Deploy con Hardhat (recomendado para este proyecto)

El proyecto ya usa Node.js + pnpm; Hardhat se integra sin instalar binarios extra.

```bash
cd contracts

# 1. Instalar deps (incluye @openzeppelin/contracts 5.1.0 pinneado)
pnpm install

# 2. Compilar
pnpm run build

# 3. Test (opcional pero recomendado)
pnpm run test

# 4. Deployar en Polygon Amoy testnet (recomendado primero)
ADMIN_ADDRESS=0xYourMultisigAddress \
ADMIN_PRIVATE_KEY=0xYourDeployerKey \
pnpm run deploy:amoy

# 5. Cuando funcione en testnet, deployar en mainnet
ADMIN_ADDRESS=0xYourMultisigAddress \
ADMIN_PRIVATE_KEY=0xYourDeployerKey \
pnpm run deploy:polygon
```

El script de deploy imprime las addresses para que las copies a `wrangler.jsonc`.

## Deploy con Foundry (alternativa)

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit

cat > foundry.toml <<EOF
[profile.default]
src = "."
out = "out"
libs = ["lib"]
remappings = [
    "@openzeppelin/=lib/openzeppelin-contracts/",
]
solc = "0.8.24"
EOF

forge build

ADMIN_ADDRESS=0xYourAdminWallet \
forge create --rpc-url https://polygon-rpc.com \
  --private-key $ADMIN_PRIVATE_KEY \
  EdificARteBadge.sol:EdificARteBadge \
  --constructor-args $ADMIN_ADDRESS

ADMIN_ADDRESS=0xYourAdminWallet \
forge create --rpc-url https://polygon-rpc.com \
  --private-key $ADMIN_PRIVATE_KEY \
  EdificARteReviews.sol:EdificARteReviews \
  --constructor-args $ADMIN_ADDRESS
```

## Configuración post-deploy

Después de deployar, agregar las direcciones a `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "PUBLIC_BADGE_CONTRACT_ADDRESS": "0x...badge...",
    "PUBLIC_REVIEW_CONTRACT_ADDRESS": "0x...reviews...",
    "USDC_CONTRACT_ADDRESS": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    "EDIFICARTE_PAYMENT_ADDRESS": "0x...tu wallet receptora de pagos...",
    "POLYGON_RPC_URL": "https://polygon-rpc.com"
  }
}
```

Y `ADMIN_PRIVATE_KEY` como secret:

```bash
pnpm wrangler secret put ADMIN_PRIVATE_KEY
# Te pide el valor; pegás la private key del admin wallet
```

Sin `ADMIN_PRIVATE_KEY`, los badges y reviews se siguen emitiendo **off-chain** (mock mode) — el usuario sigue ganando progreso, solo no se acuña el NFT.

## Testing local

Para probar sin gastar gas, deployar en **Polygon Amoy testnet** (chainId 80002):

```bash
forge create --rpc-url https://rpc-amoy.polygon.technology \
  --private-key $TESTNET_PRIVATE_KEY \
  src/EdificARteBadge.sol:EdificARteBadge \
  --constructor-args $ADMIN_ADDRESS
```

USDC de prueba en Amoy: `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` (verificar contra docs actuales de Circle antes de usar).

## Seguridad

- El owner del contrato puede mintear badges a cualquier address — mantenelo en una wallet fría / multisig en producción.
- El flujo asume que el backend de EdificARTE es la fuente de verdad off-chain. Si alguien bypasea el backend y llama `mintBadge` directo, sigue funcionando (no hay pérdida de fondos), pero podría mintear badges "no ganados". Trade-off aceptable para MVP.