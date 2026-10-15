import { describe, expect, it, vi } from "vitest";
import {
  basicAuthHeader,
  clearCredentials,
  getCredentials,
  hasCredentials,
  setCredentials,
  splitCredentials,
} from "./api";

// Suite unit jalan di environment `node` (vite.config.ts tanpa `environment`) → localStorage tidak ada.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

/** Ambil balik isi header supaya bisa diperiksa tanpa membaca base64 dengan mata. */
function decode(header: string): string {
  const binary = atob(header.slice("Basic ".length));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("kredensial UI (docs/09 §2)", () => {
  it("basicAuthHeader membungkus user:password jadi Basic base64", () => {
    expect(basicAuthHeader("admin:sandi")).toBe("Basic YWRtaW46c2FuZGk=");
  });

  it("password non-ASCII tidak melempar dan tetap utuh", () => {
    expect(decode(basicAuthHeader("admin:paß"))).toBe("admin:paß");
  });

  it("simpan, baca, dan hapus kredensial", () => {
    expect(hasCredentials()).toBe(false);
    setCredentials("admin", "rahasia");
    expect(hasCredentials()).toBe(true);
    expect(getCredentials()).toBe("admin:rahasia");
    clearCredentials();
    expect(getCredentials()).toBeNull();
    expect(hasCredentials()).toBe(false);
  });

  it("splitCredentials memisah di titik dua pertama saja", () => {
    expect(splitCredentials("admin:a:b")).toEqual({ user: "admin", password: "a:b" });
    expect(splitCredentials("admin")).toEqual({ user: "admin", password: "" });
  });
});
