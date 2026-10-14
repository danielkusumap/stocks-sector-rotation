import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { apiPost, type StartRunResponse } from "../lib/api";
import { usePlanPicks, useMetaSectors } from "../hooks/useApiQuery";
import { useRunProgress } from "../hooks/usePipeline";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Skeleton } from "../components/ui/Skeleton";
import { PickCard } from "../components/domain/PickCard";
import { RulesPanel } from "../components/domain/RulesPanel";
import { RunningWatch } from "../components/domain/RunningWatch";
import { formatDate, formatNum } from "../lib/format";
import { cn } from "../lib/cn";
import {
  PICK_DAYS_REQUIRED,
  computeBannerText,
  dateTabLabel,
  dayBadge,
  needsCompute,
  summaryLine,
} from "../lib/swingPicks";

/**
 * Halaman **Swing Trade** (`/swing`, docs/08 F25): rekomendasi tanggal aktif + pantau yang berjalan.
 * Angka sepenuhnya dari `GET /plan/picks`; tab tanggal hidup di URL (`?date=`) dan tiap tanggal
 * punya cache sendiri (`staleTime` 5 menit) sehingga berpindah tab bolak-balik tidak memanggil ulang.
 */
export default function SwingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDate = searchParams.get("date");
  const picks = usePlanPicks(urlDate ? { as_of: urlDate } : {});
  const meta = useMetaSectors();
  const queryClient = useQueryClient();
  // tab lain dimuat **setelah** halaman idle supaya pembukaan tetap satu permintaan (AC 2/9)
  const [ready, setReady] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [computing, setComputing] = useState(false);

  const data = picks.data;
  const asOf = data?.as_of ?? null;
  const dates = data?.available_dates ?? [];
  const otherDates = dates.filter((date) => date !== asOf);

  useEffect(() => {
    if (!asOf) return;
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 300));
    const handle = idle(() => setReady(true));
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(handle as number) : window.clearTimeout(handle as number));
  }, [asOf]);

  // Progres hitung 5 hari (docs/08 F25 butir 8). Selesai → cache pick di-invalidate.
  const runQuery = useRunProgress(runId, (run) => {
    setComputing(false);
    if (run.status !== "failed") void queryClient.invalidateQueries({ queryKey: ["plan-picks"] });
  });
  const run = runQuery.data?.run;

  const startCompute = async () => {
    setComputing(true);
    try {
      const started = await apiPost<StartRunResponse, { stage: string; plan_days: number }>(
        "/admin/compute",
        { stage: "ta", plan_days: PICK_DAYS_REQUIRED },
        { async: true },
      );
      setRunId(started.run_id);
    } catch {
      setComputing(false);
      await picks.refetch();
    }
  };

  const selectDate = (date: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("date", date);
    setSearchParams(next, { replace: true });
    setHighlighted(null);
  };

  const sectorFor = (code: string) => {
    const item = meta.data?.items.find((entry) => entry.code === code);
    return item ? { name: item.name_id, colorToken: item.color_token } : null;
  };

  const today = new Date().toISOString().slice(0, 10);
  const showBanner = needsCompute(dates) || computing || run !== undefined;
  const pickList = data?.picks ?? [];

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="swing-page">
      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold">Swing Trade</h1>
        <span className="text-sm text-fg-muted">
          Rencana hasil saring aturan, terbaru lebih dulu. Harga penyesuaian.
        </span>
      </header>

      {/* baris pemilih hari: 5 hari bursa terakhir dari API, tab aktif di URL */}
      {dates.length > 0 && (
        <div role="tablist" aria-label="Tanggal pick" className="flex flex-wrap items-center gap-1" data-testid="swing-dates">
          {dates.map((date) => {
            const selected = date === asOf;
            return (
              <button
                key={date}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`swing-date-${date}`}
                onClick={() => selectDate(date)}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2.5 text-sm",
                  selected ? "bg-accent-subtle font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {dateTabLabel(date)}
                {date === asOf && pickList.length === 0 && <span className="text-fg-faint">0</span>}
              </button>
            );
          })}
        </div>
      )}

      {picks.isPending && (
        <div className="flex flex-col gap-3" data-testid="swing-skeleton">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {picks.isError && <ErrorState error={picks.error} onRetry={() => void picks.refetch()} />}

      {data && (
        <>
          <p className="text-sm text-fg-muted" data-testid="swing-summary">
            {summaryLine(data)}
            {asOf && dayBadge(asOf, today) && (
              <span data-testid="swing-day-badge" className="ml-2 text-warn">
                {dayBadge(asOf, today)}
              </span>
            )}
          </p>

          {/* butir 8: 5 hari bursa belum lengkap → tombol hitung (tanpa terminal, tanpa tombol di /data) */}
          {showBanner && (
            <div
              data-testid="swing-compute-banner"
              className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
            >
              <p className="font-medium">{computeBannerText(dates)}</p>
              <p className="text-sm text-fg-muted">
                Hitung rencana 5 hari bursa terakhir dari halaman ini — perkiraan ±2,5 menit, jangan
                tutup tab (data harga yang ada dipakai ulang, tidak ada unduhan baru).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => void startCompute()}
                  disabled={computing || (run !== undefined && run.status === "running")}
                  data-testid="swing-compute-button"
                >
                  Hitung 5 hari terakhir
                </Button>
                {runId !== null && (
                  <Button onClick={() => void picks.refetch()} data-testid="swing-reload-button">
                    Muat ulang
                  </Button>
                )}
              </div>
              {run && (
                <div data-testid="swing-compute-progress">
                  <ProgressBar percent={run.percent} message={run.message} />
                  <p className="mt-1 text-sm text-fg-muted">
                    {run.status === "running"
                      ? `menghitung… ${run.message ?? ""}`
                      : run.status === "ok"
                        ? `selesai${run.finished_at ? ` ${formatDate(run.finished_at)}` : ""} — pilih tanggal untuk melihat hasil`
                        : run.status === "failed"
                          ? "gagal — cek riwayat run di halaman Data"
                          : run.status}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* kartu pick tanggal aktif */}
          {pickList.length > 0 ? (
            <div className="flex flex-col gap-3" data-testid="swing-cards">
              {pickList.map((pick) => (
                <PickCard key={pick.ticker} pick={pick} sector={sectorFor(pick.sector_code)} />
              ))}
            </div>
          ) : (
            <div data-testid="swing-empty">
              <EmptyState
                title={`Tidak ada kandidat lolos saring pada tanggal ini`}
                hint={`${formatNum(data.screened)} kandidat sebelum potong limit · longgarkan aturan? aturan tidak diubah dari UI — lihat panel "Aturan penyaringan" di bawah.`}
              />
            </div>
          )}

          {data.rules.length > 0 && <RulesPanel rules={data.rules} />}

          <RunningWatch
            dates={otherDates}
            ready={ready}
            highlighted={highlighted}
            onPickDate={(date) => {
              selectDate(date);
              setHighlighted(null);
            }}
          />
        </>
      )}
    </div>
  );
}
