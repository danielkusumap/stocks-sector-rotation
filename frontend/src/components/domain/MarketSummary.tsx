import type { BriefingResponse, SectorSeriesResponse, WatchItem } from "../../lib/api";
import type { ReactNode } from "react";
import { formatPct } from "../../lib/format";
import { StatCard } from "../ui/StatCard";
import { QuadrantBadge } from "../ui/QuadrantBadge";
import { StreakBadge } from "../ui/StreakBadge";
import { SectorSeries } from "../charts/SectorSeries";

/** Nama regime dari API (`docs/05` §3) — kalimat penjelasannya datang dari `regime_note`. */
const REGIME_LABEL: Record<string, string> = {
  risk_on: "Risk-on",
  risk_off: "Risk-off",
  mixed: "Campur",
};

/** Batas tampilan (docs/08 F13d): maks 6 kalimat ringkasan & 3 item watchlist. */
const MAX_SUMMARY_LINES = 6;
const MAX_WATCH_ITEMS = 3;

/**
 * Ringkasan pasar (docs/06 §8 + F6): kartu IHSG (dari `/meta/market`, lihat `IhsgCard`),
 * sektor naik-turun / breadth / regime dari `/briefing/morning`, kalimat penjelasan regime,
 * ringkasan teks singkat + watchlist (docs/08 F13d), dan mini `SectorSeries` sektor teratas.
 * Teks dari API dirender **apa adanya** — frontend tidak menyusun kalimat finansial sendiri.
 */
export function MarketSummary({
  briefing,
  series,
  ihsg,
}: {
  briefing: BriefingResponse;
  series?: SectorSeriesResponse;
  /** Kartu IHSG — sumbernya `/meta/market` (docs/08 F13c), bukan `briefing.market`. */
  ihsg?: ReactNode;
}) {
  const market = briefing.market;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        {ihsg}
        <StatCard
          label="Sektor naik"
          value={`${market.sectors_up} / ${market.sectors_down}`}
          note="naik / turun"
        />
        <StatCard
          label="Breadth"
          value={`${market.breadth.advancers} ↑ / ${market.breadth.decliners} ↓`}
          note={`${market.breadth.unchanged} stagnan`}
        />
        <StatCard
          label="Regime"
          value={REGIME_LABEL[market.regime] ?? market.regime}
          note={`IHSG 1 minggu ${formatPct(market.ihsg_ret_1w)}`}
        />
      </div>

      <p className="text-sm text-fg-muted" data-testid="regime-note">
        {market.regime_note}
      </p>

      {/* Ringkasan singkat (docs/08 F13d no.1): kalimat dari backend, dirender apa adanya. */}
      <section className="border-t border-border pt-2" data-testid="summary-lines">
        <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
          Ringkasan singkat
        </h3>
        {briefing.summary_lines && briefing.summary_lines.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1 text-sm text-fg">
            {briefing.summary_lines.slice(0, MAX_SUMMARY_LINES).map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-fg-faint">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-fg-muted">belum ada hasil hitung</p>
        )}
      </section>

      {/* Perlu dipantau (docs/08 F13d no.2): `[]` → blok tidak dirender sama sekali. */}
      {briefing.watchlist && briefing.watchlist.length > 0 && (
        <section className="border-t border-border pt-2" data-testid="watchlist">
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            Perlu dipantau
          </h3>
          <ul className="mt-1 flex flex-col gap-1.5">
            {briefing.watchlist.slice(0, MAX_WATCH_ITEMS).map((item) => (
              <WatchRow key={`${item.kind}-${item.ref_id}`} item={item} />
            ))}
          </ul>
        </section>
      )}

      {series && series.points.length > 1 && (
        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            Seri {series.code} vs IHSG
          </p>
          <SectorSeries data={series} />
        </div>
      )}
    </div>
  );
}

/** Satu baris "Perlu dipantau": sektor → nama, saham → ticker (nama sebagai keterangan). */
function WatchRow({ item }: { item: WatchItem }) {
  return (
    <li className="flex flex-col gap-0.5" data-testid={`watch-${item.ref_id}`}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.kind === "stock" ? item.ref_id : item.name}</span>
        <QuadrantBadge quadrant={item.quadrant} />
        <StreakBadge weeks={item.streak_weeks} />
        {item.kind === "stock" && <span className="text-sm text-fg-muted">{item.name}</span>}
      </span>
      <span className="text-sm text-fg-muted">{item.reason}</span>
    </li>
  );
}
