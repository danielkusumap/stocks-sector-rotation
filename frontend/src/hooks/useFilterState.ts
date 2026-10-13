import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_FILTERS, readFilters, toSearch, type FilterState } from "../lib/urlFilters";

/**
 * Patch filter: objek, atau fungsi dari state terbaru. Pakai bentuk fungsi kalau nilainya
 * diturunkan dari filter sekarang (arah urut, centang) — lihat catatan di `setFilters`.
 */
export type FilterPatch = Partial<FilterState> | ((prev: FilterState) => Partial<FilterState>);

/** Filter hidup di URL; hook ini satu-satunya cara membacanya (docs/08 aturan 4). */
export function useFilterState(defaults: FilterState = DEFAULT_FILTERS) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams, defaults), [searchParams, defaults]);

  const setFilters = useCallback(
    (patch: FilterPatch) => {
      // `searchParams` dari render bisa tertinggal dari URL: navigasi react-router jalan di
      // dalam transition, jadi URL berubah sebelum props baru sampai ke komponen — klik kedua
      // yang cepat ("klik header lagi = balik arah") dulu terhitung dari state lama.
      const current = readFilters(window.location.search, defaults);
      const resolved = typeof patch === "function" ? patch(current) : patch;
      const next = { ...current, ...resolved };
      // ganti filter = kembali ke halaman pertama, kecuali patch-nya memang soal paginasi
      if (resolved.limit === undefined && resolved.offset === undefined) next.offset = 0;
      setSearchParams(toSearch(next, defaults), { replace: true });
    },
    [setSearchParams, defaults],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  return { filters, setFilters, resetFilters };
}
