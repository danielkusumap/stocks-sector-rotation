import { ApiError } from "./api";

/** Pesan galat yang bisa dibaca user — pesan backend apa adanya, bukan stack trace. */
export function apiErrorMessage(error: unknown, fallback = "Terjadi kesalahan."): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
