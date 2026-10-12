/** Progress bar run; `percent: null` = total baris belum diketahui → spinner (docs/05 §4.3). */
export function ProgressBar({ percent, message }: { percent: number | null; message?: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label="Kemajuan proses"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 w-40 overflow-hidden rounded-full bg-bg-subtle"
      >
        {percent === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-info" />
        ) : (
          <div className="h-full rounded-full bg-info" style={{ width: `${percent}%` }} />
        )}
      </div>
      <span className="font-mono text-sm text-fg-muted">
        {percent === null ? "…" : `${percent.toFixed(1).replace(".", ",")}%`}
      </span>
      {message && <span className="truncate text-sm text-fg-muted">{message}</span>}
    </div>
  );
}
