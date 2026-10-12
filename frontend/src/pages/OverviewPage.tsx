import { useState } from "react";
import { QuadrantChart } from "../components/charts/QuadrantChart";
import { FilterBar } from "../components/domain/FilterBar";
import { SectorTable } from "../components/domain/SectorTable";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useMetaSectors, useRrg, useSectorSummary } from "../hooks/useApiQuery";
import { useFilterState } from "../hooks/useFilterState";
import { sectorSortOf } from "../lib/sectorTable";

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

  return (
    <div className="flex flex-col gap-3">
      <Panel
      title="Diagram RRG — Sektor"
      actions={rrg.data ? <FreshnessPill status={rrg.data.data_status} /> : null}
    >
      {rrg.isPending ? (
        <div className="p-3">
          <TableSkeleton rows={8} cols={5} />
        </div>
      ) : rrg.isError ? (
        <ErrorState error={rrg.error} onRetry={() => void rrg.refetch()} />
      ) : (
        <div className="p-3">
          <QuadrantChart
            items={rrg.data.items}
            selectedRefId={selectedRefId}
            onSelect={setSelectedRefId}
            label="Diagram RRG sektor"
          />
            <p className="mt-2 text-sm text-fg-muted">
              Klik titik untuk mengunci pilihan (Esc atau klik area kosong untuk melepas); klik
              baris tabel memindahkan kunci ke sektor itu.
            </p>
          </div>
        )}
      </Panel>

      <Panel
        title="Sektor"
        actions={summary.data ? <FreshnessPill status={summary.data.data_status} /> : null}
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
            onSort={(next) => setFilters({ sort: next.sort, dir: next.dir })}
            selectedRefId={selectedRefId}
            onSelect={setSelectedRefId}
            onResetFilters={resetFilters}
          />
        )}
      </Panel>
    </div>
  );
}
