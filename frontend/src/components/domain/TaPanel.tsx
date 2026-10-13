import { useState } from "react";
import type { TaScope, Timeframe, Weighting, Window } from "../../lib/api";
import { formatDate, formatNum, formatRp } from "../../lib/format";
import {
  coverageText,
  eventRows,
  filterCompareText,
  periodsText,
  resultLabel,
  resultTone,
  statsOf,
  winRateText,
} from "../../lib/taTable";
import { useMetaConfig, useTaDetail } from "../../hooks/useApiQuery";
import { Delta } from "../ui/Delta";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Pill } from "../ui/Pill";
import { Segmented } from "../ui/Segmented";
import { Skeleton, TableSkeleton } from "../ui/Skeleton";
import { StatCard } from "../ui/StatCard";
import { Table, Td, Th } from "../ui/Table";

/**
 * Panel analisa teknikal (docs/06 §5.1, docs/08 F17) — **satu komponen** untuk
 * drawer Sektor (`scope=sector`) dan halaman Saham (`scope=stock`).
 *
 * Sumber: `GET /api/v1/ta/{scope}/{ref_id}`. Semua angka datang jadi dari backend
 * (`win_rate`, median, event, `gain_since`); frontend hanya memformat & menerjemahkan
 * label (docs/03 §10 milik backend). Kontrol: MA + toggle filter tren; keduanya
 * dikirim sebagai query dan hasilnya di-echo respons (`ma_period`, `trend_filter`),
 * jadi default tetap milik `/meta/config` — tidak ada ambang yang di-hardcode di UI.
 */
export function TaPanel({
  scope,
  refId,
  timeframe,
  weighting,
  asOf,
  window,
}: {
  scope: TaScope;
  refId: string;
  timeframe?: Timeframe;
  weighting?: Weighting;
  asOf?: string;
  window?: Window;
}) {
  const config = useMetaConfig();
  // `null` = ikut default backend/config (respons mengembalikan nilai yang dipakai)
  const [maPeriod, setMaPeriod] = useState<number | null>(null);
  const [trendFilter, setTrendFilter] = useState<boolean | null>(null);

  // periode jendela (`window`) hanya relevan untuk deret MA yang belum dirender (opsional v1)
  const detail = useTaDetail(scope, refId, {
    timeframe,
    weighting,
    as_of: asOf,
    window,
    ma_period: maPeriod ?? undefined,
    trend_filter: trendFilter ?? undefined,
  });

  const data = detail.data;
  // pilihan user menang atas nilai yang di-echo respons; kalau belum dipilih → default backend
  // (dari `/meta/config`), sehingga tidak ada ambang yang di-hardcode di UI.
  const appliedMa = maPeriod ?? data?.ma_period;
  const appliedFilter = trendFilter ?? data?.trend_filter ?? false;
  const stats = statsOf(data, appliedFilter);
  const latest = data?.latest ?? null;
  const events = eventRows(data?.events);
  const minHistory = config.data?.ta?.min_history ?? 0;
  const maOptions = config.data?.ta?.ma_periods ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid={`ta-panel-${refId}`}>
      <div className="flex flex-wrap items-center gap-3">
        {maOptions.length > 0 && (
          <Segmented
            label="Periode MA"
            value={String(appliedMa)}
            onChange={(value) => setMaPeriod(Number(value))}
            options={maOptions.map((period) => ({ value: String(period), label: `MA${period}` }))}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={appliedFilter}
            onChange={(event) => setTrendFilter(event.target.checked)}
          />
          filter tren MA50
        </label>
        <span className="text-sm text-fg-faint">
          {data ? `MA${data.ma_period} · ${events.length} event terakhir` : ""}
        </span>
      </div>

      {detail.isPending ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
          <TableSkeleton rows={4} cols={5} />
        </>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatCard
              label="+5% dulu"
              value={winRateText(stats?.win_rate)}
              note="menang ÷ (menang + kalah)"
            />
            <StatCard
              label="Median periode ke +5%"
              value={periodsText(stats?.median_periods_win)}
            />
            <StatCard
              label="Median periode ke −5%"
              value={periodsText(stats?.median_periods_loss)}
            />
            <StatCard
              label="Jumlah event"
              value={formatNum(stats?.n_events, 0)}
              note={
                stats
                  ? `${formatNum(stats.expired, 0)} lewat batas · ${formatNum(stats.open, 0)} belum selesai (bukan kekalahan)`
                  : undefined
              }
            />
          </div>

          <div className="rounded-md border border-border bg-surface p-3 text-sm" data-testid="ta-latest">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted uppercase">Terakhir breakout</span>
              {latest ? (
                <>
                  <span className="font-mono">
                    {formatDate(latest.signal_date)} → {formatDate(latest.entry_date)}
                  </span>
                  <span className="font-mono">
                    {formatRp(latest.entry_price)}
                    {" "}
                    <span className="text-fg-muted">harga penyesuaian</span>
                  </span>
                  <span className="text-fg-muted">{periodsText(latest.periods_since)} sejak entry</span>
                  <Delta value={latest.gain_since} />
                  <Pill tone={resultTone(latest.result)} label={resultLabel(latest.result)} />
                </>
              ) : (
                <span data-testid="ta-empty">belum ada breakout pada periode MA ini</span>
              )}
            </p>
          </div>

          {data && (
            <p className="text-sm text-fg-muted" data-testid="ta-filter-compare">
              {filterCompareText(data.stats.filter_on, data.stats.filter_off)}
            </p>
          )}

          {events.length === 0 ? (
            <EmptyState
              title="belum ada breakout pada periode MA ini"
              hint="Naikkan/turunkan periode MA, atau matikan filter tren untuk melihat sinyal lebih banyak."
            />
          ) : (
            <Table caption={`Event analisa teknikal ${refId} (MA ${data?.ma_period ?? ""})`}>
              <thead>
                <tr>
                  <Th>Sinyal</Th>
                  <Th>Entry</Th>
                  <Th align="right">Harga entry</Th>
                  <Th>Hasil</Th>
                  <Th align="right">Periode</Th>
                  <Th align="right">Harga keluar</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={`${row.signal_date}-${row.entry_date}`} data-testid={`ta-event-${row.signal_date}`}>
                    <Td className="font-mono text-sm">{formatDate(row.signal_date)}</Td>
                    <Td className="font-mono text-sm">{formatDate(row.entry_date)}</Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatRp(row.entry_price)}
                    </Td>
                    <Td>
                      <Pill tone={resultTone(row.result)} label={resultLabel(row.result)} />
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {formatNum(row.periods, 0)}
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">
                      {row.exit_price === null ? "—" : formatRp(row.exit_price)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <p className="text-sm text-fg-faint" data-testid="ta-coverage">
            {coverageText(data?.coverage, scope, minHistory)}
          </p>
        </>
      )}
    </div>
  );
}
