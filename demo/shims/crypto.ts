// Browser stand-in for the parts of `node:crypto` Radiarr uses.
import { Buffer } from 'buffer';
import { sha1 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export function randomBytes(n: number): Buffer {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Buffer.from(b);
}
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
export function createHash(alg: string) {
  const parts: Uint8Array[] = [];
  const api = {
    update(data: string | Uint8Array) {
      parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      return api;
    },
    digest(enc?: string) {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      const h = alg === 'sha256' ? sha256(all) : sha1(all);
      return enc === 'hex' ? bytesToHex(h) : Buffer.from(h);
    },
  };
  return api;
}
export function scryptSync(): never {
  throw new Error('Passwords are not available in the demo.');
}
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
export default { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual };
