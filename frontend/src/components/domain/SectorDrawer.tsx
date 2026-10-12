import { useState } from "react";
import type { Dir, StockSort, Timeframe, Weighting, Window } from "../../lib/api";
import { formatNum, formatRp, formatRpCompact } from "../../lib/format";
import { nextSort } from "../../lib/sectorTable";
import { useRrg, useSector, useSectorSeries, useStocks } from "../../hooks/useApiQuery";
import { QuadrantBadge } from "../ui/QuadrantBadge";
import { StreakBadge } from "../ui/StreakBadge";
import { Table, Td, Th } from "../ui/Table";
import { Delta } from "../ui/Delta";
import { Drawer } from "../ui/Drawer";
import { ErrorState } from "../ui/ErrorState";
import { QuadrantChart } from "../charts/QuadrantChart";
import { SectorSeries } from "../charts/SectorSeries";
import { TableSkeleton } from "../ui/Skeleton";
import { streakLabel } from "../../lib/labels";

/** Kolom tabel konstituen (docs/06 §5 `StockTable`, versi ringkas untuk drawer). */
const CONSTITUENT_COLUMNS: readonly { key: string; label: string; sort: StockSort | null }[] = [
  { key: "ticker", label: "Ticker", sort: "ticker" },
  { key: "close", label: "Harga", sort: null },
  { key: "ret_1w", label: "1M", sort: "ret_1w" },
  { key: "turnover", label: "Turnover", sort: "turnover" },
  { key: "rsi14", label: "RSI", sort: null },
  { key: "stock_score", label: "Skor", sort: "stock_score" },
];

/**
 * `SectorDrawer` (docs/06 §5, docs/08 F7): panel 720px dari klik baris tabel.
 * Isi: metrik sektor, `SectorSeries` (indeks vs IHSG), tabel konstituen (sort lewat API
 * `/stocks?sector=…&timeframe=…`), dan mini-RRG saham sektor itu.
 * Fokus terkunci + Esc + pemulihan fokus ditangani `Drawer` (Radix Dialog).
 */
export function SectorDrawer({
  code,
  onClose,
  timeframe,
  window,
  weighting,
  asOf,
}: {
  /** `null` = tertutup. Dibaca dari URL (`?sector=IDXFINANCE`) supaya bisa di-share. */
  code: string | null;
  onClose: () => void;
  timeframe: Timeframe;
  window: Window;
  weighting: Weighting;
  asOf?: string;
}) {
  const detail = useSector(code ?? "", { timeframe, weighting, as_of: asOf });
  const series = useSectorSeries(code ?? "", { timeframe, weighting });
  const [sort, setSort] = useState<StockSort>("stock_score");
  const [dir, setDir] = useState<Dir>("desc");
  const stocks = useStocks({
    sector: code ? [code] : [],
    timeframe,
    as_of: asOf,
    sort,
    dir,
    limit: 20,
  });
  const rrg = useRrg({ scope: "stock", sector: code ? [code] : undefined, timeframe, window, weighting });
  const [pickedStock, setPickedStock] = useState<string | null>(null);

  const metrics = detail.data?.metrics;

  return (
    <Drawer
      open={code !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={detail.data ? `${detail.data.sector.name_id} — detail sektor` : "Detail sektor"}
    >
      <div className="flex flex-col gap-4">
        {detail.isPending ? (
          <TableSkeleton rows={4} cols={3} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: detail.data.sector.color_hex }}
              />
              <span className="font-mono text-sm text-fg-muted">{detail.data.sector.code}</span>
              <QuadrantBadge quadrant={metrics?.quadrant} />
              {metrics && <StreakBadge weeks={metrics.streak_weeks} />}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              <Metric label="RS-Ratio" value={formatNum(metrics?.rs_ratio, 2)} />
              <Metric label="RS-Momentum" value={formatNum(metrics?.rs_momentum, 2)} />
              <Metric label="Skor" value={formatNum(metrics?.score, 1)} />
              <Metric label="1 minggu" value={<Delta value={metrics?.ret_1w ?? null} />} />
              <Metric
                label="Streak"
                value={metrics ? (streakLabel(metrics.streak_weeks) ?? "—") : "—"}
              />
              <Metric
                label="Naik / turun"
                value={metrics ? `${metrics.advancers} / ${metrics.decliners}` : "—"}
              />
              <Metric label="Emiten aktif" value={formatNum(metrics?.constituents_count, 0)} />
            </dl>
          </>
        )}

        <section>
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            Indeks vs IHSG
          </h3>
          {series.isPending ? (
            <TableSkeleton rows={3} cols={2} />
          ) : series.isError ? (
            <ErrorState error={series.error} onRetry={() => void series.refetch()} />
          ) : (
            <SectorSeries data={series.data} height={160} />
          )}
        </section>

        <section>
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            Konstituen {stocks.data ? `(${stocks.data.total})` : ""}
          </h3>
          {stocks.isPending ? (
            <TableSkeleton rows={6} cols={6} />
          ) : stocks.isError ? (
            <ErrorState error={stocks.error} onRetry={() => void stocks.refetch()} />
          ) : (
            <Table caption={`Konstituen sektor ${detail.data?.sector.name_id ?? code}`}>
              <thead>
                <tr>
                  {CONSTITUENT_COLUMNS.map((column) => {
                    const next = nextSort({ sort, dir }, column);
                    return (
                      <Th
                        key={column.key}
                        align={column.key === "ticker" ? "left" : "right"}
                        sortable={Boolean(next)}
                        active={column.sort === sort}
                        dir={dir}
                        onSort={next ? () => { setSort(next.sort); setDir(next.dir); } : undefined}
                      >
                        {column.label}
                      </Th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {stocks.data.items.map((row) => (
                  <tr key={row.ticker} data-testid={`constituent-${row.ticker}`}>
                    <Td>
                      <span className="font-medium">{row.ticker}</span>
                      <span className="ml-2 text-sm text-fg-muted">{row.name}</span>
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatRp(row.close)}
                    </Td>
                    <Td align="right">
                      <Delta value={row.ret_1w} />
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatRpCompact(row.median_turnover_20d_idr)}
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatNum(row.rsi14, 1)}
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatNum(row.stock_score, 1)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <section>
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            RRG saham sektor ini
          </h3>
          {rrg.isPending ? (
            <TableSkeleton rows={5} cols={4} />
          ) : rrg.isError ? (
            <ErrorState error={rrg.error} onRetry={() => void rrg.refetch()} />
          ) : (
            <QuadrantChart
              items={rrg.data.items}
              scope="stock"
              selectedRefId={pickedStock}
              onSelect={setPickedStock}
              label={`RRG saham ${detail.data?.sector.name_id ?? code}`}
              showAllHref={`/stocks?sector=${code}`}
            />
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
