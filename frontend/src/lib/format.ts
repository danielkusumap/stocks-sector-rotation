const TZ = "Asia/Jakarta"; // zona waktu tunggal aplikasi (AGENTS.md aturan 8)

/** "2026-10-12T16:31:02+07:00" → "12 Okt 2026 16:31" (WIB). F3 menambah formatRp/formatPct dll. di file ini. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(".", ":"); // id-ID memakai titik sebagai pemisah jam
  return `${day} ${time}`;
}

/** Jam WIB saja: "11:05". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(".", ":");
}

/** Detik → "42,1 s" / "1 mnt 12 s" (koma desimal Indonesia). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1).replace(".", ",")} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} mnt ${Math.round(seconds % 60)} s`;
}

// ── Angka (docs/03 §8) ───────────────────────────────────────────────────────
// Satuan ringkas: T = triliun, M = miliar, jt = juta. Nilai null → "—" (bukan 0).

/** Angka bi-asa: `1234.5 → "1.234,5"`. `decimals` = jumlah angka di belakang koma. */
export function formatNum(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return idNumber(value, decimals);
}

/**
 * Harga rupiah: `4250 → "4.250"` (tanpa awalan "Rp" — satuannya ada di label kolom,
 * lihat mock docs/06 §8 "entry 4.250").
 */
export function formatRp(value: number | null | undefined): string {
  return formatNum(value, 0);
}

/** Nilai rupiah ringkas: `1180000000000 → "1,18 T"`, `980000000 → "980,0 jt"`. */
export function formatRpCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${idNumber(value / 1e12, 2)} T`;
  if (abs >= 1e9) return `${idNumber(value / 1e9, 1)} M`;
  if (abs >= 1e6) return `${idNumber(value / 1e6, 1)} jt`;
  return idNumber(value, 0);
}

/** Persen dengan tanda eksplisit: `0.0181 → "+1,81%"`, `-0.0045 → "−0,45%"`. */
export function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${sign(value)}${idNumber(Math.abs(value) * 100, decimals)}%`;
}

/** Perubahan (Δ) tanpa satuan: `0.42 → "+0,42"`, `-0.31 → "−0,31"`. */
export function formatDelta(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${sign(value)}${idNumber(Math.abs(value), decimals)}`;
}

/** Tanda arah selalu ada (docs/06 §4: warna saja tidak cukup); nol tanpa tanda. */
function sign(value: number): string {
  if (value > 0) return "+";
  if (value < 0) return "−"; // U+2212, bukan hyphen
  return "";
}

function idNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
