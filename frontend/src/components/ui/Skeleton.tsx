import { cn } from "../../lib/cn";

/** Skeleton dengan tinggi akhir yang sama seperti isinya → tidak ada CLS (docs/06 §9 no.5). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-bg-subtle", className)} />;
}

/** Meniru bentuk tabel: header 32px + n baris 36px (docs/06 §4). */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Memuat data">
      <div className="flex h-8 items-center gap-2 border-b border-border bg-bg-subtle px-2">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-9 items-center gap-2 border-b border-border px-2">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-3 flex-1", c === 0 && "max-w-32")} />
          ))}
        </div>
      ))}
    </div>
  );
}
