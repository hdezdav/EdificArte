# Contratos EdificARTE

Estos son los contratos Solidity para los features on-chain de EdificARTE. **No están deployados** — el código está listo para que vos los deployes cuando quieras usando Foundry o Hardhat.

## Contratos

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `EdificARteBadge.sol` | ERC-721 | NFTs de medallas por visitar monumentos |
| `EdificARteReviews.sol` | Event emitter | Registro público de reviews |

## Dependencias

Ambos contratos dependen de OpenZeppelin Contracts v5.x.

```bash
# Con Foundry
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Con Hardhat
pnpm add @openzeppelin/contracts
```

## Deploy con Foundry (recomendado)

```bash
# 1. Inicializar proyecto Foundry si no está
forge init --no-commit --no-git
# Copiar los .sol acá y ajustar remappings

# 2. Configurar remappings en foundry.toml
# cat > foundry.toml <<EOF
# [profile.default]
# src = "src"
# out = "out"
# libs = ["lib"]
# remappings = [
#     "@openzeppelin/=lib/openzeppelin-contracts/"
# ]
# EOF

# 3. Compilar
forge build

# 4. Deployar EdificARteBadge en Polygon mainnet
ADMIN_ADDRESS=0xYourAdminWallet
forge create --rpc-url https://polygon-rpc.com \
  --private-key $ADMIN_PRIVATE_KEY \
  src/EdificARteBadge.sol:EdificARteBadge \
  --constructor-args $ADMIN_ADDRESS

# 5. Deployar EdificARteReviews
forge create --rpc-url https://polygon-rpc.com \
  --private-key $ADMIN_PRIVATE_KEY \
  src/EdificARteReviews.sol:EdificARteReviews \
  --constructor-args $ADMIN_ADDRESS
```

## Deploy con Hardhat

```bash
pnpm add --save-dev hardhat @nomicfoundation/hardhat-toolbox @openzeppelin/contracts
npx hardhat init

# Crear scripts/deploy.js con el contenido de abajo
cat > scripts/deploy.js <<'EOF'
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Badge = await hre.ethers.getContractFactory("EdificARteBadge");
  const badge = await Badge.deploy(deployer.address);
  await badge.waitForDeployment();
  console.log("EdificARteBadge deployed to:", await badge.getAddress());

  const Reviews = await hre.ethers.getContractFactory("EdificARteReviews");
  const reviews = await Reviews.deploy(deployer.address);
  await reviews.waitForDeployment();
  console.log("EdificARteReviews deployed to:", await reviews.getAddress());
}

main().catch(console.error);
EOF

npx hardhat run scripts/deploy.js --network polygon
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