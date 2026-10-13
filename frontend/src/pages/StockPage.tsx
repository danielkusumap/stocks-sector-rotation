import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { QuadrantChart } from "../components/charts/QuadrantChart";
import { FilterBar } from "../components/domain/FilterBar";
import { StockTable } from "../components/domain/StockTable";
import { Delta } from "../components/ui/Delta";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { QuadrantBadge } from "../components/ui/QuadrantBadge";
import { StreakBadge } from "../components/ui/StreakBadge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useMetaSectors, useRrg, useStock, useStocks } from "../hooks/useApiQuery";
import { useFilterState } from "../hooks/useFilterState";
import { formatNum, formatRp, formatRpCompact, formatDate } from "../lib/format";
import { polyline } from "../lib/seriesChart";
import { stockSortOf } from "../lib/stockTable";

/** Debounce pencarian (docs/08 F8): 300 ms setelah ketikan terakhir. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * `/stocks` — tabel semua saham + filter (URL) + paginasi `limit`/`offset` + pencarian `q` debounce.
 * `/stocks/{ticker}` — detail saham: metrik, sparkline harga, RRG vs sektor, snapshot pick terakhir.
 * Filter & pencarian selalu di URL (`lib/urlFilters.ts`), tidak ada state filter terpisah.
 */
export default function StockPage() {
  const { ticker } = useParams();
  return ticker ? <StockDetail ticker={ticker} /> : <StockList />;
}

function StockList() {
  const { filters, setFilters, resetFilters } = useFilterState();
  const sectors = useMetaSectors();
  const stocks = useStocks({
    timeframe: filters.timeframe,
    as_of: filters.as_of ?? undefined,
    sector: filters.sector,
    quadrant: filters.quadrant,
    ret_positive_only: filters.ret_positive_only,
    // `q` kosong tidak dikirim sama sekali (docs/08 F8)
    q: filters.q.trim() === "" ? undefined : filters.q.trim(),
    min_turnover_idr: filters.min_turnover_idr ?? undefined,
    min_price_idr: filters.min_price_idr ?? undefined,
    sort: stockSortOf(filters.sort),
    dir: filters.dir,
    limit: filters.limit,
    offset: filters.offset,
  });

  // kotak pencarian punya state sendiri (mengetik terasa instan), URL ditulis setelah 300 ms
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => setFilters({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  return (
    <Panel
      title="Saham"
      actions={stocks.data ? <FreshnessPill status={stocks.data.data_status} /> : null}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Cari
          <input
            type="search"
            value={search}
            aria-label="Cari ticker atau nama"
            placeholder="mis. BBRI"
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-44 rounded-sm border border-border-strong bg-surface px-2 text-base text-fg"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Harga ≥ Rp
          <input
            type="number"
            min={0}
            aria-label="Harga minimal"
            value={filters.min_price_idr ?? ""}
            onChange={(event) => setFilters({ min_price_idr: Number(event.target.value) || null })}
            className="h-8 w-24 rounded-sm border border-border-strong bg-surface px-2 font-mono text-base text-fg"
          />
        </label>
      </div>

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        resetFilters={resetFilters}
        sectors={sectors.data?.items ?? []}
        shown={stocks.data?.items.length ?? 0}
        total={stocks.data?.total ?? 0}
      />

      {stocks.isPending ? (
        <div className="p-3">
          <TableSkeleton rows={10} cols={8} />
        </div>
      ) : stocks.isError ? (
        <ErrorState error={stocks.error} onRetry={() => void stocks.refetch()} />
      ) : (
        <StockTable
          items={stocks.data.items}
          total={stocks.data.total}
          limit={stocks.data.limit}
          offset={stocks.data.offset}
          sort={filters.sort}
          dir={filters.dir}
          onSort={(next) => setFilters({ sort: next.sort, dir: next.dir })}
          onPage={(offset) => setFilters({ offset })}
          onResetFilters={resetFilters}
        />
      )}
    </Panel>
  );
}

function StockDetail({ ticker }: { ticker: string }) {
  const { filters } = useFilterState();
  const location = useLocation();
  const stock = useStock(ticker);
  const sectorCode = stock.data?.stock.sector_code ?? "";
  const rrg = useRrg({
    scope: "stock",
    sector: sectorCode ? [sectorCode] : undefined,
    timeframe: filters.timeframe,
    window: filters.window,
    weighting: filters.weighting,
  });
  const [picked, setPicked] = useState<string | null>(ticker);

  const metrics = stock.data?.metrics;
  const pick = stock.data?.last_pick;
  const closes = (stock.data?.series ?? []).map((point) => point.close);

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={stock.data ? `${stock.data.stock.name} (${ticker})` : `Saham ${ticker}`}
        actions={
          <Link
            to={{ pathname: "/stocks", search: location.search }}
            className="text-sm text-accent underline underline-offset-2"
          >
            ← Semua saham
          </Link>
        }
      >
        {stock.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={5} cols={4} />
          </div>
        ) : stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-2xl font-semibold">{formatRp(metrics?.close)}</span>
              <Delta value={metrics?.ret_1d} />
              <QuadrantBadge quadrant={metrics?.quadrant} />
              <span className="text-sm text-fg-muted">
                {stock.data.stock.sector_code} · {stock.data.stock.yahoo_symbol}
              </span>
              <Sparkline values={closes} className="ml-auto" />
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              <Metric label="RS-Ratio" value={formatNum(metrics?.rs_ratio, 2)} />
              <Metric label="RS-Momentum" value={formatNum(metrics?.rs_momentum, 2)} />
              <Metric label="Skor" value={formatNum(metrics?.stock_score, 1)} />
              <Metric label="RSI 14" value={formatNum(metrics?.rsi14, 1)} />
              <Metric label="ATR 14" value={formatRp(metrics?.atr14)} />
              <Metric label="SMA 20" value={formatRp(metrics?.sma20)} />
              <Metric label="SMA 50" value={formatRp(metrics?.sma50)} />
              <Metric label="Turnover 20h" value={formatRpCompact(metrics?.median_turnover_20d_idr)} />
              <Metric label="1 hari" value={<Delta value={metrics?.ret_1d ?? null} />} />
              <Metric label="1 minggu" value={<Delta value={metrics?.ret_1w ?? null} />} />
              <Metric label="1 bulan" value={<Delta value={metrics?.ret_1m ?? null} />} />
              <Metric
                label="Margin likuiditas"
                value={
                  metrics?.margin_to_min_turnover === null || metrics?.margin_to_min_turnover === undefined
                    ? "—"
                    : `${formatNum(metrics.margin_to_min_turnover, 1)}×`
                }
              />
            </dl>
          </div>
        )}
      </Panel>

      <Panel title="Snapshot pick terakhir">
        {stock.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={2} cols={3} />
          </div>
        ) : stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        ) : pick ? (
          <div className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-fg-muted">pekan {formatDate(pick.week_end)}</span>
              <span className="font-mono">peringkat {pick.rank}</span>
              <StreakBadge weeks={pick.streak_weeks} />
            </div>
            <dl className="grid grid-cols-3 gap-x-6 gap-y-1">
              <Metric label="Entry" value={formatRp(pick.entry_ref)} />
              <Metric label="Stop" value={formatRp(pick.stop)} />
              <Metric label="Target" value={formatRp(pick.target)} />
            </dl>
            <p className="text-fg-muted">{pick.rationale}</p>
          </div>
        ) : (
          <p className="p-3 text-sm text-fg-faint" data-testid="no-pick">
            — saham ini belum pernah masuk daftar pick mingguan.
          </p>
        )}
      </Panel>

      <Panel title="RRG saham vs sektor">
        {rrg.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={6} cols={4} />
          </div>
        ) : rrg.isError ? (
          <ErrorState error={rrg.error} onRetry={() => void rrg.refetch()} />
        ) : (
          <div className="p-3">
            <QuadrantChart
              items={rrg.data.items}
              scope="stock"
              selectedRefId={picked}
              onSelect={setPicked}
              label={`RRG saham sektor ${sectorCode}`}
              showAllHref={`/stocks?sector=${sectorCode}`}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

/** `Sparkline` (docs/06 §5): 80×24, tanpa axis, warna `--up`/`--down` sesuai perubahan total. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const up = values[values.length - 1] >= values[0];
  return (
    <svg
      viewBox="0 0 80 24"
      width={80}
      height={24}
      aria-hidden="true"
      data-testid="sparkline"
      className={className}
    >
      <polyline
        points={polyline(values, 80, 24, 2)}
        fill="none"
        strokeWidth={1.5}
        stroke={up ? "var(--up)" : "var(--down)"}
      />
    </svg>
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
