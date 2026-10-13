import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { RunHistory } from "../components/domain/RunHistory";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Panel } from "../components/ui/Panel";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Pill } from "../components/ui/Pill";
import { ToastStack, useToasts } from "../components/ui/Toast";
import { useMetaSectors, useRuns } from "../hooks/useApiQuery";
import { useRunProgress, useStartStep } from "../hooks/usePipeline";
import type { ImportResult } from "../lib/api";
import {
  PIPELINE,
  RUN_KIND,
  errorMessage,
  importReasonLabel,
  isFinal,
  lastRun,
  lockReason,
  skippedMessage,
  statusChip,
  stepTitle,
  type PipelineStep,
} from "../lib/pipeline";

/** Halaman Data: satu-satunya pintu masuk pipeline (docs/08 F12). */
export default function DataPage() {
  const queryClient = useQueryClient();
  const { items: toasts, push, dismiss } = useToasts();
  const runsQuery = useRuns(20);
  const runs = runsQuery.data?.runs ?? [];
  const meta = useMetaSectors();
  const activeEmiten = (meta.data?.items ?? []).reduce((total, s) => total + s.constituents_active, 0);

  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [confirmStep, setConfirmStep] = useState<PipelineStep | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const runQuery = useRunProgress(activeRunId, (run) => {
    void queryClient.invalidateQueries(); // docs/05 §5.1: "Refresh data tampilan"
    if (run.status === "ok" || run.status === "partial") {
      push("ok", `${stepTitle(run.kind)} selesai${run.message ? ` — ${run.message}` : ""}.`);
    } else if (run.status === "skipped") {
      push("info", skippedMessage(run));
    } else {
      push("warn", `Gagal: ${stepTitle(run.kind)}${run.message ? ` — ${run.message}` : ""}. Lihat riwayat run.`);
    }
  });
  const activeRun = runQuery.data?.run;

  const start = useStartStep(
    (run) => {
      setActiveRunId(run.run_id);
      push("info", `Langkah dikirim (run #${run.run_id}). Proses jalan di latar belakang.`);
    },
    (error) => push("warn", errorMessage(error)),
  );

  const launch = (step: PipelineStep, file?: File) => {
    // Tombol 2 memanggil Yahoo ratusan kali → konfirmasi dulu (docs/05 §4.2)
    if (step.kind === RUN_KIND.pricesDaily && !file) {
      setConfirmStep(step);
      return;
    }
    start.mutate({ step, file });
  };

  return (
    <>
      <div className="mb-3 flex items-end gap-3">
        <div>
          <h2 className="text-md font-semibold">Data &amp; pipeline</h2>
          <p className="text-sm text-fg-muted">
            Jalankan berurutan dari atas ke bawah. Semua langkah jalan di latar belakang; halaman ini aman
            ditinggal.
          </p>
        </div>
        <Button
          className="ml-auto"
          onClick={() => {
            void queryClient.invalidateQueries();
            void runsQuery.refetch();
          }}
        >
          Muat ulang data
        </Button>
      </div>

      <Panel title="Langkah pipeline" className="mb-4">
        <ol className="list-none">
          {PIPELINE.map((step) => {
            const lock = lockReason(step, runs);
            const last = lastRun(runs, step.kind);
            const workingHere = activeRunId !== null && activeRun?.kind === step.kind;
            return (
              <li
                key={step.kind}
                className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-sm text-fg-muted"
                >
                  {step.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{step.title}</h3>
                    <span className="text-sm text-fg-muted">
                      <Pill
                        tone={last?.status ?? "idle"}
                        label={statusChip(step, runs)}
                        bold={last?.status === "failed"}
                      />
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-fg-muted">{step.hint}</p>
                  {workingHere && (
                    <div className="mt-2">
                      <ProgressBar percent={activeRun.percent} message={activeRun.message} />
                    </div>
                  )}
                  {lock && <p className="mt-1 text-sm text-warn">{lock}</p>}
                  {step.kind === RUN_KIND.importExcel && last && isFinal(last.status) && last.result_json != null && (
                    <ImportSummary result={last.result_json as ImportResult} />
                  )}
                </div>
                <div className="pt-0.5">
                  {step.kind === RUN_KIND.importExcel ? (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".xlsx"
                        tabIndex={-1}
                        className="sr-only"
                        onChange={(event) => {
                          const picked = event.target.files?.[0];
                          event.target.value = ""; // supaya file yang sama bisa dipilih ulang
                          if (picked) launch(step, picked);
                        }}
                      />
                      <Button variant="primary" onClick={() => fileInput.current?.click()}>
                        Pilih file &amp; import
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant={step.n === 2 ? "primary" : "outline"}
                      disabled={Boolean(lock)}
                      title={lock ?? undefined}
                      onClick={() => launch(step)}
                    >
                      Jalankan
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <RunHistory runs={runs} error={runsQuery.isError ? runsQuery.error : null} />

      <ConfirmDialog
        open={confirmStep !== null}
        title="Ambil harga harian?"
        confirmLabel="Ya, jalankan"
        onCancel={() => setConfirmStep(null)}
        onConfirm={() => {
          const step = confirmStep;
          setConfirmStep(null);
          if (step) start.mutate({ step });
        }}
      >
        Mengunduh harga harian untuk <strong>{activeEmiten}</strong> emiten aktif. Sekitar 1,5 menit saat
        pertama kali karena memanggil Yahoo ratusan kali (berikutnya ±10 detik). Proses berjalan di latar
        belakang.
      </ConfirmDialog>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <details className="mt-2 text-sm text-fg-muted">
      <summary className="cursor-pointer">
        {result.inserted} emiten baru · {result.updated} diperbarui · {result.deactivated} dinonaktifkan ·{" "}
        <span className={result.errors.length > 0 ? "text-warn" : undefined}>
          {result.errors.length} baris gagal
        </span>
      </summary>
      {result.errors.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {result.errors.map((error) => (
            <li key={`${error.sheet}-${error.row_no}`}>
              <span className="font-mono">
                {error.sheet} baris {error.row_no}
              </span>{" "}
              — {importReasonLabel(error.reason)}
              {error.raw_value ? ` (isi: "${error.raw_value}")` : " (isi kosong)"}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
