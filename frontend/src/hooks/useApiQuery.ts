import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  apiGet,
  type BriefingParams,
  type BriefingResponse,
  type FreshnessResponse,
  type HeatmapResponse,
  type MarketResponse,
  type MetaConfigResponse,
  type MetaDatesParams,
  type MetaDatesResponse,
  type MetaSectorsResponse,
  type RrgParams,
  type RrgResponse,
  type RotationMatrixParams,
  type RotationMatrixResponse,
  type RunResponse,
  type RunsResponse,
  type SectorDetailParams,
  type SectorDetailResponse,
  type SectorSeriesParams,
  type SectorSeriesResponse,
  type SectorSummaryParams,
  type SectorSummaryResponse,
  type StockDetailResponse,
  type StockSeriesParams,
  type StockSeriesResponse,
  type TaDetailParams,
  type TaDetailResponse,
  type TaScope,
  type TaSummaryParams,
  type TaSummaryResponse,
  type StocksParams,
  type StocksResponse,
  type WeeklyPicksParams,
  type WeeklyPicksResponse,
} from "../lib/api";
import { isFinal } from "../lib/pipeline";
import { keyFor } from "../lib/queryKeys";

/** Satu hook per endpoint docs/05 §1–§3. Kunci cache ikut parameter yang dikirim. */
function useApi<T, P extends object>(name: string, path: string, params?: P, enabled = true) {
  return useQuery({
    queryKey: keyFor(name, params),
    queryFn: ({ signal }) => apiGet<T, P>(path, params, signal),
    enabled,
    // data lama tetap tampil saat filter/sort berubah: tidak ada kedip skeleton, dan
    // elemen yang sedang difokuskan (mis. baris tabel) tidak ikut ter-unmount
    placeholderData: keepPreviousData,
  });
}

export const useMetaSectors = () => useApi<MetaSectorsResponse, object>("meta-sectors", "/meta/sectors");

/** Tanggal yang punya hasil hitung (docs/05 §1) — dipakai `AsOfPicker` untuk menonaktifkan libur. */
export const useMetaDates = (params: MetaDatesParams) =>
  useApi<MetaDatesResponse, MetaDatesParams>("meta-dates", "/meta/dates", params);

export const useMetaConfig = () => useApi<MetaConfigResponse, object>("meta-config", "/meta/config");

export const useFreshness = () => useApi<FreshnessResponse, object>("freshness", "/freshness");

/**
 * Kutipan IHSG (`docs/05` §1). Dipoll selama tab terlihat saja (`refetchIntervalInBackground:
 * false`) dengan interval dari `/meta/config` → `market.poll_seconds`, plus refetch saat tab
 * kembali fokus. `keepPreviousData`: kartu mempertahankan angka terakhir saat fetch gagal
 * (docs/08 F13c: "matikan backend → kartu bertahan", bukan kotak error kosong).
 */
export function useMarket(live = true, pollSeconds = 60) {
  return useQuery({
    queryKey: keyFor("market", { live }),
    queryFn: ({ signal }) =>
      apiGet<MarketResponse, { live?: boolean }>("/meta/market", live ? { live: true } : undefined, signal),
    // interval dari config (`market.poll_seconds`); lantai 1 s hanya penjaga salah konfigurasi
    refetchInterval: Math.max(1, pollSeconds) * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

export const useRrg = (params: RrgParams) => useApi<RrgResponse, RrgParams>("rrg", "/rrg", params);

export const useSectorSummary = (params: SectorSummaryParams) =>
  useApi<SectorSummaryResponse, SectorSummaryParams>("sectors-summary", "/sectors/summary", params);

export const useSector = (code: string, params: SectorDetailParams = {}) =>
  useApi<SectorDetailResponse, SectorDetailParams>(
    `sector:${code}`,
    `/sectors/${code}`,
    params,
    Boolean(code),
  );

export const useStocks = (params: StocksParams) =>
  useApi<StocksResponse, StocksParams>("stocks", "/stocks", params);

export const useStock = (ticker: string) =>
  useApi<StockDetailResponse, object>(`stock:${ticker}`, `/stocks/${ticker}`, undefined, Boolean(ticker));

/** Grafik candle + overlay TA satu saham (`docs/05` §2 `/series/stock/{ticker}`). */
export const useStockSeries = (ticker: string, params: StockSeriesParams = {}) =>
  useApi<StockSeriesResponse, StockSeriesParams>(
    `series-stock:${ticker}`,
    `/series/stock/${ticker}`,
    params,
    Boolean(ticker),
  );

export const useRotationMatrix = (params: RotationMatrixParams) =>
  useApi<RotationMatrixResponse, RotationMatrixParams>("rotation-matrix", "/rotation/matrix", params);

export const useHeatmap = () => useApi<HeatmapResponse, object>("heatmap", "/heatmap");

export const useSectorSeries = (code: string, params: SectorSeriesParams = {}) =>
  useApi<SectorSeriesResponse, SectorSeriesParams>(
    `series:${code}`,
    `/series/sector/${code}`,
    params,
    Boolean(code),
  );

export const useWeeklyPicks = (params: WeeklyPicksParams) =>
  useApi<WeeklyPicksResponse, WeeklyPicksParams>("weekly-picks", "/weekly/picks", params);

export const useBriefing = (params: BriefingParams = {}) =>
  useApi<BriefingResponse, BriefingParams>("briefing", "/briefing/morning", params);

export const useRuns = (limit = 20) =>
  useApi<RunsResponse, { limit: number }>("runs", "/admin/runs", { limit });

/** Ringkasan TA satu halaman (`docs/08` F17: **satu** permintaan untuk semua baris tabel). */
export const useTaSummary = (params: TaSummaryParams) =>
  useApi<TaSummaryResponse, TaSummaryParams>("ta-summary", "/ta/summary", params);

/** Detail TA satu entitas (`docs/06` §5.1); `refId` kosong → query tidak jalan. */
export const useTaDetail = (scope: TaScope, refId: string, params: TaDetailParams = {}) =>
  useApi<TaDetailResponse, TaDetailParams>(
    `ta:${scope}:${refId}`,
    `/ta/${scope}/${refId}`,
    params,
    Boolean(refId),
  );

/** Poll 1 s selama status belum final; berhenti sendiri saat `ok|partial|failed|skipped` (docs/05 §5.1). */
export function useRun(runId: number | null) {
  return useQuery({
    queryKey: keyFor("run", { run_id: runId }),
    queryFn: ({ signal }) => apiGet<RunResponse, object>(`/admin/runs/${runId}`, undefined, signal),
    enabled: runId !== null,
    refetchInterval: (query) => (isFinal(query.state.data?.run.status) ? false : 1000),
  });
}
