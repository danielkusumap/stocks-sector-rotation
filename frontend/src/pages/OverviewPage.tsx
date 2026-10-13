import { useState } from "react";
import { HeatmapGrid } from "../components/charts/HeatmapGrid";
import { QuadrantChart } from "../components/charts/QuadrantChart";
import { RotationMatrix } from "../components/charts/RotationMatrix";
import { ChangeList } from "../components/domain/ChangeList";
import { FilterBar } from "../components/domain/FilterBar";
import { IhsgCard } from "../components/domain/IhsgCard";
import { MarketSummary } from "../components/domain/MarketSummary";
import { PeriodNote } from "../components/domain/PeriodNote";
import { SectorDrawer } from "../components/domain/SectorDrawer";
import { SectorTable } from "../components/domain/SectorTable";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { Skeleton, TableSkeleton } from "../components/ui/Skeleton";
import {
  useBriefing,
  useHeatmap,
  useMetaSectors,
  useRotationMatrix,
  useRrg,
  useSectorSeries,
  useSectorSummary,
} from "../hooks/useApiQuery";
import { useFilterState } from "../hooks/useFilterState";
import { useSetPeriodLabel } from "../components/layout/ScopeControls";
import { periodFromStatus } from "../lib/period";
import { nextSort, sectorSortOf } from "../lib/sectorTable";

/**
 * Overview: diagram RRG + tabel sektor. Satu `selectedRefId` dipakai chart dan tabel
 * (docs/06 §6.1: pin dua arah). Filter hidup di URL (`useFilterState`).
 */
export default function OverviewPage() {
  const { filters, setFilters, resetFilters } = useFilterState();
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);

  const sectors = useMetaSectors();
  const rrg = useRrg({
    timeframe: filters.timeframe,
    window: filters.window,
    weighting: filters.weighting,
    as_of: filters.as_of ?? undefined,
    scope: "sector",
  });
  const summary = useSectorSummary({
    timeframe: filters.timeframe,
    window: filters.window,
    weighting: filters.weighting,
    as_of: filters.as_of ?? undefined,
    sector: filters.sector,
    quadrant: filters.quadrant,
    min_streak: filters.min_streak,
    min_turnover_idr: filters.min_turnover_idr ?? undefined,
    ret_positive_only: filters.ret_positive_only,
    sort: sectorSortOf(filters.sort),
    dir: filters.dir,
    limit: filters.limit,
    offset: filters.offset,
  });
  const briefing = useBriefing({ as_of: filters.as_of ?? undefined, top_n: 3 });
  const heatmap = useHeatmap();
  const matrix = useRotationMatrix({
    timeframe: filters.timeframe,
    window: filters.window,
  });
  // seri mini untuk sektor teratas (dari briefing, bukan dihitung di frontend)
  const topSector = briefing.data?.leaders[0]?.code ?? "";
  const series = useSectorSeries(topSector, {
    timeframe: filters.timeframe,
    weighting: filters.weighting,
  });
  // Drawer detail dibuka dari URL: `?sector=IDXFINANCE` (satu sektor = fokus, docs/08 F7)
  const openSector = filters.sector.length === 1 ? filters.sector[0] : null;
  const openDetail = (code: string) => {
    setSelectedRefId(code);
    setFilters({ sector: [code] });
  };

  // label periode di topbar + subjudul panel (docs/08 F13 C): rentangnya dari `data_status`,
  // bukan dihitung di sini
  const period = periodFromStatus(rrg.data?.data_status, {
    timeframe: filters.timeframe,
    window: filters.window,
  });
  useSetPeriodLabel(period);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
      title="Diagram RRG — Sektor"
      actions={
        <>
          {rrg.data && <PeriodNote text={period} />}
          {rrg.data ? <FreshnessPill status={rrg.data.data_status} /> : null}
        </>
      }
    >
      {rrg.isPending ? (
        <div className="flex flex-col gap-2 p-3">
          {/* skeleton meniru bentuk akhir (rasio chart 780×608 + tinggi kotak legenda) supaya
              tidak ada pergeseran tata letak saat data datang (docs/08 F11 CLS) */}
          <Skeleton className="aspect-[780/608] w-full" />
          <Skeleton className="h-24 w-64" />
        </div>
      ) : rrg.isError ? (
        <ErrorState error={rrg.error} onRetry={() => void rrg.refetch()} />
      ) : (
        <div className="p-3">
          <QuadrantChart
            items={rrg.data.items}
            selectedRefId={selectedRefId}
            onSelect={setSelectedRefId}
            onOpenDetail={openDetail}
            label="Diagram RRG sektor"
          />
            <p className="mt-2 text-sm text-fg-muted">
              Klik titik untuk mengunci pilihan (Esc atau klik area kosong untuk melepas); klik
              baris tabel memindahkan kunci ke sektor itu.
            </p>
          </div>
        )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel
            title="Ringkasan Pasar"
            actions={briefing.data ? <FreshnessPill status={briefing.data.data_status} /> : null}
          >
            {briefing.isPending ? (
              <div className="p-3">
                <TableSkeleton rows={4} cols={2} />
              </div>
            ) : briefing.isError ? (
              <ErrorState error={briefing.error} onRetry={() => void briefing.refetch()} />
            ) : (
              <MarketSummary
                briefing={briefing.data}
                ihsg={<IhsgCard />}
                series={series.data && series.data.code === topSector ? series.data : undefined}
              />
            )}
          </Panel>

          <Panel title="Perubahan Kuadran">
            {briefing.isPending ? (
              <div className="p-3">
                <TableSkeleton rows={3} cols={1} />
              </div>
            ) : briefing.isError ? (
              <ErrorState error={briefing.error} onRetry={() => void briefing.refetch()} />
            ) : (
              <ChangeList changes={briefing.data.changes} />
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Peta Panas Sektor"
        actions={
          heatmap.data ? (
            <span className="text-sm text-fg-muted">
              {heatmap.data.rows.length} sektor × {heatmap.data.columns.length} periode
            </span>
          ) : null
        }
      >
        {heatmap.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={11} cols={5} />
          </div>
        ) : heatmap.isError ? (
          <ErrorState error={heatmap.error} onRetry={() => void heatmap.refetch()} />
        ) : (
          <HeatmapGrid data={heatmap.data} />
        )}
      </Panel>

      <Panel title="Matriks Rotasi">
        {matrix.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={5} cols={5} />
          </div>
        ) : matrix.isError ? (
          <ErrorState error={matrix.error} onRetry={() => void matrix.refetch()} />
        ) : (
          <RotationMatrix data={matrix.data} />
        )}
      </Panel>

      <Panel
        title="Sektor"
        actions={
          <>
            {summary.data && <PeriodNote text={period} />}
            {summary.data ? <FreshnessPill status={summary.data.data_status} /> : null}
          </>
        }
      >
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          resetFilters={resetFilters}
          sectors={sectors.data?.items ?? []}
          shown={summary.data?.items.length ?? 0}
          total={summary.data?.total ?? 0}
        />
        {summary.isPending ? (
          <div className="p-3">
            <TableSkeleton rows={11} cols={8} />
          </div>
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <SectorTable
            items={summary.data.items}
            total={summary.data.total}
            sort={filters.sort}
            dir={filters.dir}
            onSort={(column) => setFilters((prev) => nextSort(prev, column) ?? {})}
            selectedRefId={selectedRefId}
            onSelect={openDetail}
            onResetFilters={resetFilters}
          />
        )}
      </Panel>

      <SectorDrawer
        code={openSector}
        onClose={() => setFilters({ sector: [] })}
        timeframe={filters.timeframe}
        window={filters.window}
        weighting={filters.weighting}
        asOf={filters.as_of ?? undefined}
      />
    </div>
  );
}
