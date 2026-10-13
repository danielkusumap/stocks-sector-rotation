import { useMetaConfig, useMarket } from "../../hooks/useApiQuery";
import { cn } from "../../lib/cn";
import { formatDateTime, formatNum } from "../../lib/format";
import { Delta } from "../ui/Delta";
import { Skeleton } from "../ui/Skeleton";

/**
 * Kartu IHSG (docs/08 F13c) — satu-satunya kutipan "harga sekarang" di aplikasi; sektor & saham
 * tetap dari hasil hitung di DB (docs/05 §1: "HANYA benchmark IHSG"). Sumbernya
 * `GET /meta/market?live=true`, dipoll sesuai `market.poll_seconds` dari `/meta/config`.
 *
 * Aturan tampilan: feed IDX selalu delay → selalu ada "per <waktu> WIB · delay", dan kalau
 * angkanya jatuh ke data tersimpan (`source: "db"`) itu ditulis apa adanya, tidak dipoles
 * jadi seolah live.
 */
export function IhsgCard({ live = true }: { live?: boolean }) {
  const config = useMetaConfig();
  const pollSeconds = config.data?.market?.poll_seconds ?? 60;
  const query = useMarket(live, pollSeconds);
  const data = query.data;

  // belum ada respons pertama (dan belum ada data sebelumnya) → skeleton setinggi kartu
  if (query.isPending || !data) {
    return (
      <div className="rounded-md border border-border bg-surface p-3" data-testid="ihsg-card">
        <p className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">IHSG</p>
        {query.isPending ? (
          // tinggi skeleton ≈ kartu akhirnya (angka + 2 baris keterangan) → tidak ada CLS
          <div className="mt-1 flex flex-col gap-1" aria-hidden="true">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <p className="mt-1 font-mono text-2xl font-semibold text-fg-faint">—</p>
        )}
        <p className="mt-0.5 text-sm text-fg-muted">
          {query.isError ? "kutipan IHSG tidak bisa diambil" : "menunggu kutipan…"}
        </p>
      </div>
    );
  }

  // penanda sumber: `source` dari API + status `data_status` (docs/08 F13c no.3 & no.5)
  const stored = data.source === "db" || data.data_status.status === "stale" || query.isError;
  const showIntraday = data.session === "open" && data.ret_intraday !== null;

  return (
    <div className="rounded-md border border-border bg-surface p-3" data-testid="ihsg-card">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
        {/* dot: accent = kutipan live · amber = angka tersimpan (docs/08 F13c no.3) */}
        <span
          aria-hidden="true"
          data-testid="ihsg-source-dot"
          data-source={stored ? "db" : "live"}
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stored ? "bg-warn" : "bg-accent")}
        />
        {data.benchmark}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        {/* lebar tetap + tabular-nums: angka bergerak tanpa menggeser kartu (F13c no.7) */}
        <span className="w-32 font-mono text-2xl font-semibold tabular-nums" data-testid="ihsg-close">
          {formatNum(data.close, 2)}
        </span>
        <Delta value={data.ret_1d} />
      </p>
      <p className="mt-0.5 text-sm text-fg-muted" data-testid="ihsg-meta">
        per {formatDateTime(data.last_bar_at)} WIB
        {data.delayed && " · delay"}
      </p>
      {showIntraday && (
        <p className="text-sm text-fg-muted" data-testid="ihsg-intraday">
          intraday <Delta value={data.ret_intraday} />
        </p>
      )}
      {stored && (
        <p className="text-sm text-warn" data-testid="ihsg-stored">
          data tersimpan terakhir {formatDateTime(data.last_bar_at)}
        </p>
      )}
    </div>
  );
}
