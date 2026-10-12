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
