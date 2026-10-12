import { formatDate } from "./format";

/** Nama hari, Senin lebih dulu (kalender Indonesia). */
export const DAY_NAMES = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

const MONTH_FORMAT = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `'2026-10-12'` → `{ year: 2026, month: 9, day: 12 }` (month 0-based) atau `null` kalau bukan ISO. */
export function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  // tolak tanggal yang tidak ada (mis. 2026-02-31)
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month, day));
  return date.toISOString().slice(0, 10);
}

/** `'2026-10-12'` → `'2026-10'` (kunci bulan untuk grid). */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  return isoDate(year, month - 1 + delta, 1).slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return MONTH_FORMAT.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Judul bulan tanpa tahun (dipakai di tombol picker): `'Oktober 2026'` → `'Okt 2026'`. */
export function shortMonthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Grid satu bulan, Senin di kolom pertama: 42 sel (`null` = sel kosong sebelum/ sesudah bulan).
 * Dipakai `AsOfPicker` supaya tanggal yang tidak ada di `/meta/dates` bisa dinonaktifkan.
 */
export function monthGrid(key: string): (string | null)[] {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay: 0 = Minggu → geser supaya Senin = 0
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day >= 1 && day <= daysInMonth ? isoDate(year, month - 1, day) : null;
  });
}

/** Tanggal yang ditampilkan di tombol: nilai terpilih, atau tanggal terakhir yang punya data. */
export function asOfLabel(value: string | null, latest: string | null): string {
  if (value) return formatDate(value);
  return latest ? `terakhir ${formatDate(latest)}` : "terakhir";
}
