import { useState } from "react";
import { QuadrantChart } from "../components/charts/QuadrantChart";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useRrg } from "../hooks/useApiQuery";
import { useFilterState } from "../hooks/useFilterState";

/** Overview: diagram RRG sektor + state pin (`selectedRefId`) yang nanti dipakai bersama tabel. */
export default function OverviewPage() {
  const { filters } = useFilterState();
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);

  const rrg = useRrg({
    timeframe: filters.timeframe,
    window: filters.window,
    weighting: filters.weighting,
    as_of: filters.as_of ?? undefined,
    scope: "sector",
  });

  return (
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
            Klik titik untuk mengunci pilihan (Esc atau klik area kosong untuk melepas). Tabel sektor
            terfilter dan panel ringkasan pasar menyusul di F5–F6.
          </p>
        </div>
      )}
    </Panel>
  );
}
