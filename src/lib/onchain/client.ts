/**
 * Cliente de wallet para el browser. Wrapper sobre window.ethereum (EIP-1193).
 *
 * Vive SOLO en el cliente. Si lo importás en código server-side, va a fallar
 * (no hay window). Usá `if (typeof window !== 'undefined')` o importá
 * dinámicamente.
 *
 * Soporta cualquier wallet compatible EIP-1193: MetaMask, Rabby, Coinbase
 * Wallet, etc. NO incluye WalletConnect (eso requiere una SDK separada).
 */

import type { WalletProvider } from './types';

// ABI mínima del USDC para encodear la llamada `transfer(address,uint256)`.
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: 'accountsChanged' | 'chainChanged' | 'disconnect', handler: (...args: unknown[]) => void): void;
}

function getEthereum(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  // El estándar EIP-1193 expone window.ethereum. Algunos wallets lo exponen
  // bajo otros nombres — si tu wallet lo hace, agregalo acá.
  const w = window as unknown as { ethereum?: Eip1193Provider };
  return w.ethereum ?? null;
}

export class BrowserWalletProvider implements WalletProvider {
  private cachedAddress: string | null = null;

  async connect(): Promise<string> {
    const eth = getEthereum();
    if (!eth) {
      throw new Error(
        'No se detectó wallet. Instalá MetaMask o Rabby para continuar.'
      );
    }

    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('Conexión rechazada por el usuario.');
    }

    this.cachedAddress = accounts[0];

    // Asegurarnos de estar en Polygon mainnet (chainId 0x89 = 137).
    await this.ensurePolygon();

    return this.cachedAddress;
  }

  async getAddress(): Promise<string | null> {
    if (this.cachedAddress) return this.cachedAddress;
    const eth = getEthereum();
    if (!eth) return null;
    const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
    return accounts[0] ?? null;
  }

  async signMessage(message: string): Promise<string> {
    const eth = getEthereum();
    if (!eth) throw new Error('No hay wallet conectada.');
    const address = await this.getAddress();
    if (!address) throw new Error('Conectá tu wallet antes de firmar.');
    return (await eth.request({
      method: 'personal_sign',
      params: [message, address],
    })) as string;
  }

  async sendUsdcTransfer(args: { to: string; rawAmount: string }): Promise<string> {
    const eth = getEthereum();
    if (!eth) throw new Error('No hay wallet conectada.');
    const address = await this.getAddress();
    if (!address) throw new Error('Conectá tu wallet antes de pagar.');

    await this.ensurePolygon();

    // Encodear `transfer(address,uint256)` a mano con Function Selector
    // (0xa9059cbb) + 32 bytes address zero-padded + 32 bytes amount.
    // Esto evita cargar ethers/viem en el bundle del cliente para una sola
    // llamada.
    const cleanTo = args.to.toLowerCase().replace(/^0x/, '');
    const paddedTo = '0'.repeat(24) + cleanTo;
    const cleanAmount = BigInt(args.rawAmount).toString(16);
    const paddedAmount = '0'.repeat(64 - cleanAmount.length) + cleanAmount;

    const data = ('0xa9059cbb' + paddedTo + paddedAmount) as `0x${string}`;

    // USDC contract address en Polygon mainnet:
    const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

    const txHash = (await eth.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: address,
          to: USDC_POLYGON,
          data,
          // value: 0 (USDC es ERC-20, pagamos con el contrato, no MATIC)
        },
      ],
    })) as string;

    return txHash;
  }

  private async ensurePolygon(): Promise<void> {
    const eth = getEthereum();
    if (!eth) return;
    const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
    if (chainId === '0x89') return; // Polygon mainnet

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x89' }],
      });
    } catch (err: unknown) {
      // Si la chain no está agregada, intentar agregarla (código 4902).
      if ((err as { code?: number })?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0x89',
              chainName: 'Polygon Mainnet',
              nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
              rpcUrls: ['https://polygon-rpc.com'],
              blockExplorerUrls: ['https://polygonscan.com'],
            },
          ],
        });
      } else {
        throw new Error(
          'Necesitás estar en Polygon mainnet para usar EdificARTE. Cambiá de red en tu wallet.'
        );
      }
    }
  }
}