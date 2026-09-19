/**
 * Client-safe crypto helpers (Change 9): `crypto.randomUUID` is available in
 * all browsers and Node ≥ 19; this wrapper keeps client components free of
 * the `node:crypto` import (which is server-only) while providing a single
 * seam for UUID generation.
 */
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Extremely old browsers: RFC 4122 v4 fallback via getRandomValues.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
