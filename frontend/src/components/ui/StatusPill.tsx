import type { DataStatusKind, RunStatus } from "../../lib/api";

/**
 * Titik warna + teks: warna tidak pernah jadi satu-satunya penanda (docs/06 §4).
 * Hijau/merah (`--up`/`--down`) hanya untuk arah harga, jadi status di sini pakai
 * aksen/amber seperti aturan docs/06 §2.
 */
const DOT: Record<string, string> = {
  ok: "bg-accent",
  partial: "bg-warn",
  failed: "bg-warn",
  skipped: "bg-flat",
  running: "bg-info",
  queued: "bg-flat",
  stale: "bg-warn",
  idle: "bg-flat",
};

export type PillTone = RunStatus | DataStatusKind | "idle";

export function StatusPill({
  tone,
  label,
  bold = false,
}: {
  tone: PillTone;
  label: string;
  bold?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${bold ? "font-semibold" : ""}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone] ?? DOT.idle}`} />
      {label}
    </span>
  );
}
