/**
 * Deploy script para los contratos de EdificARTE.
 *
 * Variables de entorno:
 *   ADMIN_ADDRESS     - Address del owner que va a controlar los contratos
 *                       (recomendado: multisig Gnosis Safe en producción).
 *   ADMIN_PRIVATE_KEY - Private key de la wallet que firma el deploy.
 *                       Para Polygon mainnet, fondos para gas (~0.05 MATIC).
 *
 * Output: imprime las addresses deployadas, listas para copiar a
 *         `wrangler.jsonc` (PUBLIC_BADGE_CONTRACT_ADDRESS /
 *         PUBLIC_REVIEW_CONTRACT_ADDRESS).
 */

const hre = require("hardhat");

async function main() {
  const adminAddress = process.env.ADMIN_ADDRESS;
  if (!adminAddress || adminAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("Set ADMIN_ADDRESS env var to a non-zero address (ideally a multisig).");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Owner / admin will be:", adminAddress);

  console.log("\nDeploying EdificARteBadge (ERC-721)...");
  const Badge = await hre.ethers.getContractFactory("EdificARteBadge");
  const badge = await Badge.deploy(adminAddress);
  await badge.waitForDeployment();
  const badgeAddress = await badge.getAddress();
  console.log("EdificARteBadge deployed to:", badgeAddress);

  console.log("\nDeploying EdificARteReviews (event-only)...");
  const Reviews = await hre.ethers.getContractFactory("EdificARteReviews");
  const reviews = await Reviews.deploy(adminAddress);
  await reviews.waitForDeployment();
  const reviewsAddress = await reviews.getAddress();
  console.log("EdificARteReviews deployed to:", reviewsAddress);

  console.log("\n=== Copiá esto en wrangler.jsonc (vars): ===");
  console.log(`"PUBLIC_BADGE_CONTRACT_ADDRESS": "${badgeAddress}",`);
  console.log(`"PUBLIC_REVIEW_CONTRACT_ADDRESS": "${reviewsAddress}",`);
  console.log("\n=== Y ejecutá: ===");
  console.log("pnpm wrangler secret put ADMIN_PRIVATE_KEY");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});