import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Angka besar monospace + label uppercase + delta kecil. Nilai sudah diformat pemanggil (lib/format). */
export function StatCard({
  label,
  value,
  delta,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-surface p-3", className)}>
      <p className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
      {delta && <div className="mt-0.5 text-sm">{delta}</div>}
      {note && <p className="mt-0.5 text-sm text-fg-muted">{note}</p>}
    </div>
  );
}
