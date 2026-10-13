import { Fragment, useState } from "react";
import type { ComputeTaResult, IngestRun } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTime, formatDuration, formatNum } from "../../lib/format";
import { errorMessage, stepTitle } from "../../lib/pipeline";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { Table, Td, Th } from "../ui/Table";

const RUN_LABEL: Record<string, string> = {
  ok: "ok",
  partial: "sebagian berhasil",
  failed: "gagal",
  skipped: "dilewati",
  running: "jalan",
  queued: "menunggu",
};

/**
 * Panel riwayat run `GET /admin/runs` — **satu implementasi** untuk halaman Data (F12)
 * dan Status (F10). Baca-saja: tidak ada tombol pipeline di sini. Klik baris (atau tombol
 * `Detail` untuk keyboard) membuka `params_json`, `result_json`, dan `failed_tickers` (docs/05 §4.6).
 */
export function RunHistory({ runs, error }: { runs: IngestRun[]; error?: unknown }) {
  const [openRun, setOpenRun] = useState<number | null>(null);
  const toggle = (runId: number) => setOpenRun((current) => (current === runId ? null : runId));

  return (
    <Panel title="Riwayat run" actions={<span className="text-sm text-fg-muted">20 terakhir</span>}>
      {error ? (
        <p className="p-3 text-sm text-warn">Riwayat run tidak bisa dibaca: {errorMessage(error)}</p>
      ) : runs.length === 0 ? (
        <p className="p-3 text-sm text-fg-muted">Belum ada run. Jalankan langkah 1 untuk mulai.</p>
      ) : (
        <Table caption="Riwayat 20 run terakhir beserta status dan hasilnya">
          <thead>
            <tr>
              <Th>Langkah</Th>
              <Th>Status</Th>
              <Th>Mulai</Th>
              <Th>Durasi</Th>
              <Th>Baris</Th>
              <Th>Pesan</Th>
              <Th className="text-right">Detail</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Fragment key={run.run_id}>
                <tr
                  onClick={() => toggle(run.run_id)}
                  className={cn("cursor-pointer", run.status === "failed" && "font-semibold")}
                >
                  <Td>
                    <span
                      className={
                        run.status === "failed" || run.status === "partial"
                          ? "border-l-2 border-warn pl-1.5"
                          : "pl-1.5"
                      }
                    >
                      {stepTitle(run.kind)}
                    </span>
                  </Td>
                  <Td>
                    <Pill
                      tone={run.status}
                      label={RUN_LABEL[run.status] ?? run.status}
                      bold={run.status === "failed"}
                    />
                  </Td>
                  <Td className="font-mono text-sm">{formatDateTime(run.started_at)}</Td>
                  <Td className="font-mono text-sm">{duration(run)}</Td>
                  <Td className="font-mono text-sm text-right">{run.rows ?? "—"}</Td>
                  <Td className="text-sm text-fg-muted">{run.message ?? "—"}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation(); // klik tombol jangan dobel dengan klik baris
                        toggle(run.run_id);
                      }}
                      aria-expanded={openRun === run.run_id}
                    >
                      {openRun === run.run_id ? "Tutup" : "Detail"}
                    </Button>
                  </Td>
                </tr>
                {openRun === run.run_id && (
                  <tr>
                    <Td colSpan={7} className="h-auto bg-bg-subtle py-2">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
                        <span>run #{run.run_id}</span>
                        <span>kind: {run.kind}</span>
                        <span>phase: {run.phase ?? "—"}</span>
                        <span>rows_total: {run.rows_total ?? "—"}</span>
                        {run.params_json != null && <span>params: {JSON.stringify(run.params_json)}</span>}
                        {run.failed_tickers.length > 0 && (
                          <span>ticker gagal: {run.failed_tickers.join(", ")}</span>
                        )}
                      </div>
                      {run.result_json != null && (
                        <>
                          {isTaResult(run) && (
                            <p className="mt-1 text-sm" data-testid={`run-ta-${run.run_id}`}>
                              {taResultText(run.result_json)}
                            </p>
                          )}
                          <pre className="mt-1 overflow-x-auto font-mono text-sm text-fg">
                            {JSON.stringify(run.result_json, null, 1)}
                          </pre>
                        </>
                      )}
                    </Td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function duration(run: IngestRun): string {
  if (!run.started_at || !run.finished_at) return "—";
  const seconds = (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000;
  return formatDuration(seconds);
}

/** `compute_ta` → satu baris angka yang bisa dibaca (docs/05 §4.6), bukan cuma JSON mentah. */
function isTaResult(run: IngestRun): boolean {
  return run.kind === "compute_ta";
}

function taResultText(result: unknown): string {
  const ta = result as ComputeTaResult;
  const win = ta.win_rate === null || ta.win_rate === undefined ? "—" : `${formatNum(ta.win_rate * 100, 1)}%`;
  return `analisa teknikal: ${formatNum(ta.events, 0)} event · ${formatNum(ta.refs, 0)} emiten · menang ${win} · MA ${(ta.ma_periods ?? []).join("/")}`;
}
