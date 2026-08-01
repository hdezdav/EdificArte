// localStorage helpers — typed + safe. Both flows already used the same keys
// (turimap_reservations, turimap_cart, turimap_orders) but with ad-hoc JSON.

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or private mode — fail silently, the user can retry
  }
}

// Reservation record (tours). Same shape /yo.astro already renders.
export interface Reservation {
  id: string;
  tourId: string;
  tourTitle: string;
  name: string;
  email: string;
  phone?: string;
  date: string;
  people: number;
  notes?: string;
  payment: 'usdc' | 'pending';
  txHash?: string;
  totalMxn: number;
  totalUsdc: number;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'paid';
}

export const RESERVATIONS_KEY = 'turimap_reservations';

// Cart line item (craft purchase). Replaces the anonymous `cart` map.
export interface CartItem {
  sku: string;
  name: string;
  unitMxn: number;
  unitUsdc: number;
  image: string;
  qty: number;
}

export interface Cart {
  items: CartItem[];
  updatedAt: string;
}

export const CART_KEY = 'turimap_cart';

export function readCart(): Cart {
  return readJson<Cart>(CART_KEY, { items: [], updatedAt: '' });
}

export function writeCart(cart: Cart): void {
  writeJson(CART_KEY, cart);
}

export function readReservations(): Reservation[] {
  return readJson<Reservation[]>(RESERVATIONS_KEY, []);
}

export function addReservation(r: Reservation): void {
  const all = readReservations();
  all.push(r);
  writeJson(RESERVATIONS_KEY, all);
}

export function updateReservation(
  id: string,
  patch: Partial<Reservation>
): void {
  const all = readReservations();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx]!, ...patch };
  writeJson(RESERVATIONS_KEY, all);
}
