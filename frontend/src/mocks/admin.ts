import { HttpResponse, http } from "msw";
import type { IngestRun, MiddayResult, StartRunResponse } from "../lib/api";
import { RUN_KIND } from "../lib/pipeline";

/**
 * Mock endpoint admin (`docs/05` §4) — mensimulasikan run async supaya halaman Data
 * bisa dikerjakan tanpa backend: `POST ...?async=true` → `{run_id}`, progres naik
 * per detik, `GET /admin/runs/{id}` berhenti di status final.
 *
 * Keadaan mock (riwayat run) hidup di memori: reload halaman = "DB kosong" lagi,
 * jadi AC F12 #2 (semua tombol terkunci kecuali tombol 1) bisa diuji langsung.
 * Knob: `?mock=notfriday` → `409 gate_weekly_not_final`; `?mock=stale` → run tengah
 * hari selesai `skipped` dengan `gate: "stale"`.
 */

const API = "/api/v1";
const runs: IngestRun[] = [];
/** Jejak request (dipakai untuk membuktikan polling berhenti di status final — AC F12 #3). */
export const mockCalls: string[] = [];
(globalThis as { __mockCalls?: string[] }).__mockCalls = mockCalls;

let nextRunId = 1;

function nowWib(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().replace("Z", "+07:00");
}

const TOTAL_ROWS: Record<string, number> = {
  [RUN_KIND.importExcel]: 962,
  [RUN_KIND.pricesDaily]: 455_026,
  [RUN_KIND.pricesIntraday]: 128_400,
  [RUN_KIND.computeAll]: 11,
  [RUN_KIND.computeSignals]: 11,
  [RUN_KIND.midday]: 11,
};

function messageFor(kind: string, step: number, steps: number): string {
  if (kind === RUN_KIND.pricesDaily) return `batch ${step}/${steps} (emiten ${(step - 1) * 50 + 1}–${step * 50})`;
  if (kind === RUN_KIND.pricesIntraday) return `bar intraday ${step}/${steps}`;
  if (kind === RUN_KIND.importExcel) return `membaca sheet ${step}/${steps}`;
  if (kind === RUN_KIND.computeAll) return step < 3 ? "menghitung indeks sektor" : "menghitung RRG & skor";
  if (kind === RUN_KIND.computeSignals) return "menyusun sinyal mingguan & streak";
  return "memeriksa kesegaran data sesi 1";
}

const IMPORT_RESULT = {
  import_id: 1,
  inserted: 950,
  updated: 8,
  deactivated: 4,
  errors: [
    { sheet: "IDXFINANCE", row_no: 18, raw_value: "BCA", reason: "invalid_ticker" },
    { sheet: "IDXENERGY", row_no: 42, raw_value: "", reason: "missing_ticker" },
    { sheet: "IDXPROPERT", row_no: 7, raw_value: "BSDE", reason: "duplicate_row" },
  ],
};

function resultFor(kind: string, stale: boolean): unknown {
  if (kind === RUN_KIND.importExcel) return IMPORT_RESULT;
  if (kind === RUN_KIND.pricesDaily) return { rows: TOTAL_ROWS[kind], failed_tickers: ["MAP", "NICL"] };
  if (kind === RUN_KIND.pricesIntraday) return { rows: TOTAL_ROWS[kind], failed_tickers: [] };
  if (kind === RUN_KIND.midday) {
    const midday: MiddayResult = {
      gate: stale ? "stale" : "ok",
      last_bar_at: stale ? "2026-10-13T11:05:00+07:00" : "2026-10-13T11:42:00+07:00",
      computed: !stale,
    };
    return midday;
  }
  return { sectors: 11, tickers: 962, duration_s: 42.1 };
}

function simulate(kind: string, params: unknown, stale: boolean): StartRunResponse {
  const total = TOTAL_ROWS[kind] ?? 100;
  const steps = 5;
  const run: IngestRun = {
    run_id: nextRunId++,
    kind,
    status: "queued",
    started_at: nowWib(),
    finished_at: null,
    phase: kind.startsWith("prices") ? "ingest" : "compute",
    rows: 0,
    rows_total: total,
    percent: null,
    message: "menunggu antrean",
    failed_tickers: [],
    params_json: params ?? null,
    result_json: null,
  };
  runs.push(run);

  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    if (step <= steps) {
      run.status = "running";
      run.rows = Math.round((total * step) / steps);
      run.percent = Math.round((step / steps) * 1000) / 10;
      run.message = messageFor(kind, step, steps);
      return;
    }
    clearInterval(timer);
    run.finished_at = nowWib();
    run.rows = total;
    run.result_json = resultFor(kind, stale);
    if (kind === RUN_KIND.midday && stale) {
      run.status = "skipped";
      run.message = "Data sesi 1 belum sampai 11:30 WIB";
      return;
    }
    if (kind === RUN_KIND.importExcel) {
      run.status = "partial"; // 3 baris gagal dari 962
      run.message = "962 baris dibaca, 3 baris gagal";
      return;
    }
    run.status = "ok";
    run.percent = 100;
    run.message = "selesai";
  }, 1000);

  return { run_id: run.run_id, status: "queued" };
}

const succeeded = (kind: string) =>
  runs.some((r) => r.kind === kind && (r.status === "ok" || r.status === "partial"));

function conflict(code: string, message: string) {
  return HttpResponse.json({ api_version: "1.0", error: { code, message, detail: null } }, { status: 409 });
}

function record(path: string) {
  mockCalls.push(path);
}

export const adminHandlers = [
  http.post(`${API}/admin/import/excel`, () => {
    record("POST /admin/import/excel");
    return HttpResponse.json(simulate(RUN_KIND.importExcel, null, false), { status: 202 });
  }),

  http.post(`${API}/admin/ingest/prices`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    record(`POST /admin/ingest/prices?mode=${body.mode ?? "daily"}`);
    if (!succeeded(RUN_KIND.importExcel)) {
      return conflict("prereq_no_universe", "Tabel emiten masih kosong. Jalankan Import sektor dulu.");
    }
    const kind = body.mode === "intraday" ? RUN_KIND.pricesIntraday : RUN_KIND.pricesDaily;
    return HttpResponse.json(simulate(kind, body, false), { status: 202 });
  }),

  http.post(`${API}/admin/compute`, async ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const body = (await request.json().catch(() => ({}))) as { stage?: string; timeframe?: string };
    record(`POST /admin/compute?stage=${body.stage ?? "all"}&timeframe=${body.timeframe ?? "d1"}`);
    if (!succeeded(RUN_KIND.pricesDaily)) {
      return conflict("prereq_no_prices", "Harga harian belum ada. Jalankan Ambil harga harian dulu.");
    }
    const weekly = body.stage === "signals" && body.timeframe === "w1_fri";
    if (weekly && sp.get("mock") === "notfriday") {
      return conflict("gate_weekly_not_final", "Minggu berjalan belum final. Coba setelah penutupan Jumat.");
    }
    const kind = weekly ? RUN_KIND.computeSignals : RUN_KIND.computeAll;
    return HttpResponse.json(simulate(kind, body, false), { status: 202 });
  }),

  http.post(`${API}/admin/midday`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    record("POST /admin/midday");
    if (!succeeded(RUN_KIND.pricesDaily)) {
      return conflict("prereq_no_prices", "Harga harian belum ada. Jalankan Ambil harga harian dulu.");
    }
    if (sp.get("mock") === "stale") {
      return conflict("gate_midday_stale", "Bar terakhir 11:05 WIB, di bawah 11:30 WIB. Coba lagi nanti.");
    }
    return HttpResponse.json(simulate(RUN_KIND.midday, {}, false), { status: 202 });
  }),

  http.get(`${API}/admin/runs`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const limit = Number(sp.get("limit") ?? 20) || 20;
    record(`GET /admin/runs?limit=${limit}`);
    const sorted = [...runs].sort((a, b) => b.run_id - a.run_id).slice(0, limit);
    return HttpResponse.json({ api_version: "1.0", runs: sorted });
  }),

  http.get(`${API}/admin/runs/:run_id`, ({ params }) => {
    const id = Number(params.run_id);
    record(`GET /admin/runs/${params.run_id}`);
    const run = runs.find((r) => r.run_id === id);
    if (!run) {
      return HttpResponse.json(
        { api_version: "1.0", error: { code: "run_not_found", message: `Run ${params.run_id} tidak ada`, detail: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ api_version: "1.0", run });
  }),
];
