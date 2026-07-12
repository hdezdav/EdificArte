/**
 * Hardhat config para los contratos de EdificARTE.
 *
 * - OpenZeppelin Contracts v5.1.0 (pinneado vía package.json).
 * - Networks: Polygon mainnet (137) y Amoy testnet (80002).
 * - Compiler: 0.8.28 (pragma ^0.8.27 de los contratos).
 *
 * Uso:
 *   pnpm exec hardhat compile                     # compila contratos/
 *   pnpm exec hardhat test                        # corre tests
 *   pnpm exec hardhat run scripts/deploy.js --network polygon
 */

require("@nomicfoundation/hardhat-toolbox");

// Default Polygon RPC: Alchemy (production-grade). Override via
// POLYGON_RPC_URL env var when rotating the API key.
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-mainnet.g.alchemy.com/v2/i_UyEdWEhiRZNnF1SUmFp";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || "";

/** @type import("hardhat/config").HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./contracts/test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    polygon: {
      url: POLYGON_RPC_URL,
      chainId: 137,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: true
  },
  etherscan: {
    apiKey: process.env.SCAN_KEY
  }
};