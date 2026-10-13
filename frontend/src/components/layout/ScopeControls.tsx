import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Timeframe, Window } from "../../lib/api";
import { TIMEFRAME_OPTIONS, WINDOW_OPTIONS } from "../../lib/filters";
import type { FilterState } from "../../lib/urlFilters";
import type { FilterPatch } from "../../hooks/useFilterState";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";

/**
 * Kontrol lingkup (Timeframe + Jendela) di **topbar** (`docs/06` §8, `docs/08` F13 B):
 * satu tempat untuk semua halaman, plus label periode yang dititipkan halaman aktif.
 *
 * Halaman menulis labelnya lewat `useSetPeriodLabel` karena label itu berasal dari
 * `data_status` endpoint masing-masing (frontend tidak menyusun rentang sendiri).
 */
interface PeriodSlot {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const PeriodContext = createContext<PeriodSlot>({ label: null, setLabel: () => {} });

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

/** Dipakai halaman: titipkan label periode (`null` = halaman ini tidak punya periode). */
export function useSetPeriodLabel(label: string | null) {
  const { setLabel } = useContext(PeriodContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

/** Layar sempit (< 900 px): Segmented jadi Select supaya topbar tidak berdesakan (F13 B7). */
export function useNarrowViewport(query = "(max-width: 899px)"): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

export function ScopeControls({
  filters,
  setFilters,
}: {
  filters: FilterState;
  setFilters: (patch: FilterPatch) => void;
}) {
  const { label } = useContext(PeriodContext);
  const narrow = useNarrowViewport();
  const setTimeframe = (value: Timeframe) => setFilters({ timeframe: value });
  const setWindow = (value: Window) => setFilters({ window: value });

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {narrow ? (
        <Select
          label="Timeframe"
          value={filters.timeframe}
          onChange={setTimeframe}
          options={TIMEFRAME_OPTIONS}
        />
      ) : (
        <Segmented
          label="Timeframe"
          options={TIMEFRAME_OPTIONS}
          value={filters.timeframe}
          onChange={setTimeframe}
        />
      )}
      <Select label="Jendela" value={filters.window} onChange={setWindow} options={WINDOW_OPTIONS} />
      {label && (
        <Tooltip label={`Periode yang dipakai: ${label}`}>
          <span
            data-testid="periode-label"
            tabIndex={0}
            className="truncate text-sm text-fg-muted"
            title={label}
          >
            {label}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
