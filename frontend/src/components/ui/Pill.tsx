import type { DataStatusKind, RunStatus } from "../../lib/api";
import { cn } from "../../lib/cn";

/**
 * Titik warna + teks (dipakai untuk status run, `data_status`, dan gate).
 * Warna tidak pernah jadi satu-satunya penanda (docs/06 §4) dan hijau/merah
 * (`--up`/`--down`) hanya untuk arah harga, jadi status pakai aksen/amber (docs/06 §2).
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

export function Pill({
  tone,
  label,
  bold = false,
  className,
}: {
  tone: PillTone;
  label: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", bold && "font-semibold", className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone] ?? DOT.idle)} />
      {label}
    </span>
  );
}
