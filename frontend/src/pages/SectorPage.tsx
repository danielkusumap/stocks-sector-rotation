import { useState } from "react";
import { FilterBar } from "../components/domain/FilterBar";
import { SectorDrawer } from "../components/domain/SectorDrawer";
import { SectorTable } from "../components/domain/SectorTable";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useMetaSectors, useSectorSummary } from "../hooks/useApiQuery";
import { useFilterState } from "../hooks/useFilterState";
import { useSetPeriodLabel } from "../components/layout/ScopeControls";
import { periodFromStatus } from "../lib/period";
import { nextSort, sectorSortOf } from "../lib/sectorTable";

/**
 * Halaman Sektor: tabel penuh selebar halaman (tanpa diagram RRG).
 * Filter hidup di URL; klik baris membuka `SectorDrawer` (`?sector=IDXFINANCE`, docs/08 F7).
 */
export default function SectorPage() {
  const { filters, setFilters, resetFilters } = useFilterState();
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);

  const sectors = useMetaSectors();
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

  const openSector = filters.sector.length === 1 ? filters.sector[0] : null;
  const openDetail = (code: string) => {
    setSelectedRefId(code);
    setFilters({ sector: [code] });
  };

  const period = periodFromStatus(summary.data?.data_status, {
    timeframe: filters.timeframe,
    window: filters.window,
  });
  useSetPeriodLabel(period);

  return (
    <>
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
    </>
  );
}
