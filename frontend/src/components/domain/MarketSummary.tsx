import type { BriefingResponse, SectorSeriesResponse } from "../../lib/api";
import type { ReactNode } from "react";
import { formatPct } from "../../lib/format";
import { StatCard } from "../ui/StatCard";
import { SectorSeries } from "../charts/SectorSeries";

/** Nama regime dari API (docs/05 §3) — kalimat penjelasannya datang dari `regime_note`. */
const REGIME_LABEL: Record<string, string> = {
  risk_on: "Risk-on",
  risk_off: "Risk-off",
  netral: "Netral",
};

/**
 * Ringkasan pasar (docs/06 §8 + F6): kartu IHSG (dari `/meta/market`, lihat `IhsgCard`),
 * sektor naik-turun / breadth / regime dari `/briefing/morning`, kalimat penjelasan regime,
 * dan mini `SectorSeries` sektor teratas.
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
