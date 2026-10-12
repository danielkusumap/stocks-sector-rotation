import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_FILTERS, readFilters, toSearch, type FilterState } from "../lib/urlFilters";

/** Filter hidup di URL; hook ini satu-satunya cara membacanya (docs/08 aturan 4). */
export function useFilterState(defaults: FilterState = DEFAULT_FILTERS) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams, defaults), [searchParams, defaults]);

  const setFilters = useCallback(
    (patch: Partial<FilterState>) => {
      const next = { ...readFilters(searchParams, defaults), ...patch };
      // ganti filter = kembali ke halaman pertama, kecuali patch-nya memang soal paginasi
      if (patch.limit === undefined && patch.offset === undefined) next.offset = 0;
      setSearchParams(toSearch(next, defaults), { replace: true });
    },
    [searchParams, setSearchParams, defaults],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  return { filters, setFilters, resetFilters };
}
