import type { QueryValue } from "./api";

/**
 * Kunci cache TanStack Query dibangun dari parameter yang benar-benar dikirim,
 * jadi mengubah filter di URL = kunci berubah = data ikut berubah (AC F1).
 * Urutan kunci diurutkan supaya objek dengan isi sama menghasilkan kunci sama.
 */
export function keyFor(name: string, params?: object): unknown[] {
  const entries = Object.entries((params ?? {}) as Record<string, QueryValue>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]);
  return [name, ...entries];
}
