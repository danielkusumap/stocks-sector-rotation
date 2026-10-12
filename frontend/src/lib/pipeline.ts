import { ApiError, RUN_FINAL, type ComputeBody, type IngestPricesBody, type IngestRun, type MiddayResult, type RunStatus } from "./api";
import { formatDateTime, formatTime } from "./format";

/**
 * Enam langkah pipeline `docs/05` §4.1 — urutannya mengikat (halaman Data, docs/08 F12).
 * `kind` adalah nilai `run.kind` yang dikembalikan backend; kalau backend memakai nama lain,
 * status chip & prasyarat tombol akan selalu "belum pernah" (lihat docs/DECISIONS.md ADR-016).
 */
export const RUN_KIND = {
  importExcel: "import_excel",
  pricesDaily: "prices_daily",
  pricesIntraday: "prices_intraday",
  computeAll: "compute_all",
  computeSignals: "compute_signals",
  midday: "midday",
} as const;

export interface PipelineStep {
  n: number;
  title: string;
  hint: string;
  kind: string;
  /** langkah ini butuh hasil run `needs` yang sukses dulu (docs/05 §4.1). */
  needs?: string;
  body?: IngestPricesBody | ComputeBody;
}

export const PIPELINE: PipelineStep[] = [
  {
    n: 1,
    title: "Import sektor (Excel)",
    hint: "Baca file saham_sektoral.xlsx: daftar emiten per sektor, papan, dan jumlah lembar.",
    kind: RUN_KIND.importExcel,
  },
  {
    n: 2,
    title: "Ambil harga harian",
    hint: "Unduh harga harian semua emiten aktif (±1,5 menit saat pertama kali).",
    kind: RUN_KIND.pricesDaily,
    needs: RUN_KIND.importExcel,
    body: { mode: "daily" },
  },
  {
    n: 3,
    title: "Ambil harga intraday",
    hint: "Unduh bar 5 menit & 60 menit untuk hari ini (±30 detik).",
    kind: RUN_KIND.pricesIntraday,
    needs: RUN_KIND.importExcel,
    body: { mode: "intraday" },
  },
  {
    n: 4,
    title: "Hitung semua (harian)",
    hint: "Indeks sektor → RRG → skor → sinyal harian (±30–60 detik).",
    kind: RUN_KIND.computeAll,
    needs: RUN_KIND.pricesDaily,
    body: { stage: "all", timeframe: "d1" },
  },
  {
    n: 5,
    title: "Hitung mingguan",
    hint: "Sinyal mingguan Sen–Jum dan streak. Baru bisa setelah penutupan Jumat.",
    kind: RUN_KIND.computeSignals,
    needs: RUN_KIND.pricesDaily,
    body: { stage: "signals", timeframe: "w1_fri" },
  },
  {
    n: 6,
    title: "Tengah hari",
    hint: "Cek kesegaran data sesi 1 lalu hitung ulang angka tengah hari (±40 detik).",
    kind: RUN_KIND.midday,
    needs: RUN_KIND.pricesDaily,
  },
];

export function isFinal(status: RunStatus | undefined): boolean {
  return status !== undefined && RUN_FINAL.includes(status);
}

/** Run terbaru untuk satu kind. Urutan dari API tidak dijamin, jadi diurut sendiri. */
export function lastRun(runs: IngestRun[], kind: string): IngestRun | null {
  return [...runs].sort((a, b) => b.run_id - a.run_id).find((r) => r.kind === kind) ?? null;
}

function hasSucceeded(runs: IngestRun[], kind: string): boolean {
  return runs.some((r) => r.kind === kind && (r.status === "ok" || r.status === "partial"));
}

/** Alasan tombol terkunci, atau null kalau boleh dijalankan. Backend tetap penjaga terakhir (409). */
export function lockReason(step: PipelineStep, runs: IngestRun[]): string | null {
  if (step.needs && !hasSucceeded(runs, step.needs)) {
    const need = PIPELINE.find((s) => s.kind === step.needs);
    return `Jalankan "${need?.title ?? step.needs}" dulu.`;
  }
  return null;
}

/** Chip status: `belum pernah` / `terakhir ok 12 Okt 2026 16:31` / `gagal 2× (20 run terakhir)`. */
export function statusChip(step: PipelineStep, runs: IngestRun[]): string {
  const last = lastRun(runs, step.kind);
  if (!last) return "belum pernah";
  const label: Record<RunStatus, string> = {
    queued: "menunggu",
    running: "sedang jalan",
    ok: "ok",
    partial: "sebagian berhasil",
    failed: "gagal",
    skipped: "dilewati",
  };
  const failed = runs.filter((r) => r.kind === step.kind && r.status === "failed").length;
  const suffix = failed > 1 ? ` · gagal ${failed}×` : "";
  return `terakhir ${label[last.status]} ${formatDateTime(last.finished_at ?? last.started_at)}${suffix}`;
}

export function stepTitle(kind: string): string {
  return PIPELINE.find((s) => s.kind === kind)?.title ?? kind;
}

/** Pesan untuk run yang `skipped` karena gate kesegaran — bukan error (docs/08 F12). */
export function skippedMessage(run: IngestRun): string {
  const result = run.result_json as MiddayResult | null | undefined;
  if (result?.gate === "stale") {
    return `Data Yahoo belum sampai sesi 1 (bar terakhir ${formatTime(result.last_bar_at)} WIB, syarat 11:30 WIB). Coba lagi nanti.`;
  }
  return run.message ?? "Langkah ini dilewati.";
}

/** Kode `409` dari `docs/05` §4.1 → kalimat Indonesia (semua kode wajib punya kalimat). */
export const ERROR_LABEL: Record<string, string> = {
  prereq_no_universe:
    "Tabel emiten masih kosong. Jalankan langkah 1 (Import sektor) dulu.",
  prereq_no_prices:
    "Harga harian belum ada. Jalankan langkah 2 (Ambil harga harian) dulu.",
  gate_weekly_not_final:
    "Minggu berjalan belum final — sinyal mingguan tersedia setelah penutupan Jumat.",
  gate_midday_stale:
    "Data Yahoo belum sampai sesi 1 (bar terakhir sebelum 11:30 WIB). Coba lagi nanti.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_LABEL[error.code] ?? `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak dikenal.";
}

/** `reason` baris gagal import (`docs/05` §4) → kalimat Indonesia. */
const IMPORT_REASON_LABEL: Record<string, string> = {
  invalid_ticker: "Kode saham tidak valid",
  missing_ticker: "Kode saham kosong",
  duplicate_row: "Baris duplikat (kode sudah ada)",
  unknown_sector: "Sektor tidak dikenal",
  invalid_listing_date: "Tanggal pencatatan tidak valid",
  invalid_shares: "Jumlah lembar tidak valid",
  duplicate_ticker_in_sector: "Kode muncul dua kali di sektor yang sama",
};

export function importReasonLabel(reason: string): string {
  return IMPORT_REASON_LABEL[reason] ?? reason;
}
