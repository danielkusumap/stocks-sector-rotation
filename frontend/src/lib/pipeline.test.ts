import { describe, expect, it } from "vitest";
import { ApiError, type IngestRun, type RunStatus } from "./api";
import {
  ERROR_LABEL,
  PIPELINE,
  RUN_KIND,
  errorMessage,
  importReasonLabel,
  isFinal,
  lastRun,
  lockReason,
  skippedMessage,
  statusChip,
} from "./pipeline";

const run = (run_id: number, kind: string, status: RunStatus, extra: Partial<IngestRun> = {}): IngestRun => ({
  run_id,
  kind,
  status,
  started_at: "2026-10-12T07:02:11+07:00",
  finished_at: "2026-10-12T07:04:00+07:00",
  phase: null,
  rows: null,
  rows_total: null,
  percent: 100,
  message: null,
  failed_tickers: [],
  ...extra,
});

const step = (n: number) => PIPELINE.find((s) => s.n === n)!;

describe("prasyarat tombol pipeline (docs/05 §4.1)", () => {
  it("DB kosong → hanya tombol 1 yang boleh jalan", () => {
    expect(lockReason(step(1), [])).toBeNull();
    expect(lockReason(step(2), [])).toBe('Jalankan "Import sektor (Excel)" dulu.');
    expect(lockReason(step(3), [])).toBe('Jalankan "Import sektor (Excel)" dulu.');
    expect(lockReason(step(4), [])).toBe('Jalankan "Ambil harga harian" dulu.');
    expect(lockReason(step(5), [])).toBe('Jalankan "Ambil harga harian" dulu.');
    expect(lockReason(step(6), [])).toBe('Jalankan "Ambil harga harian" dulu.');
  });

  it("import sukses membuka tombol 2 & 3, harga harian membuka 4–6", () => {
    const afterImport = [run(1, RUN_KIND.importExcel, "ok")];
    expect(lockReason(step(2), afterImport)).toBeNull();
    expect(lockReason(step(4), afterImport)).toBe('Jalankan "Ambil harga harian" dulu.');

    const afterPrices = [...afterImport, run(2, RUN_KIND.pricesDaily, "partial")];
    expect(lockReason(step(4), afterPrices)).toBeNull();
    expect(lockReason(step(6), afterPrices)).toBeNull();
  });

  it("run yang gagal tidak membuka prasyarat", () => {
    expect(lockReason(step(2), [run(1, RUN_KIND.importExcel, "failed")])).not.toBeNull();
  });
});

describe("ringkas status run", () => {
  it("belum pernah vs terakhir ok", () => {
    expect(statusChip(step(1), [])).toBe("belum pernah");
    expect(statusChip(step(1), [run(1, RUN_KIND.importExcel, "ok")])).toBe(
      "terakhir ok 12 Okt 2026 07:04",
    );
  });

  it("menghitung kegagalan berulang", () => {
    const runs = [
      run(1, RUN_KIND.pricesDaily, "failed"),
      run(2, RUN_KIND.pricesDaily, "failed"),
      run(3, RUN_KIND.pricesDaily, "ok"),
    ];
    expect(statusChip(step(2), runs)).toContain("gagal 2×");
  });

  it("mengambil run terbaru walau daftar dari API tidak urut", () => {
    const runs = [run(3, RUN_KIND.midday, "ok"), run(9, RUN_KIND.midday, "failed")];
    expect(lastRun(runs, RUN_KIND.midday)?.run_id).toBe(9);
  });
});

describe("isFinal", () => {
  it("hanya status akhir yang menghentikan polling", () => {
    expect(isFinal("running")).toBe(false);
    expect(isFinal("queued")).toBe(false);
    expect(isFinal(undefined)).toBe(false);
    for (const s of ["ok", "partial", "failed", "skipped"] as RunStatus[]) expect(isFinal(s)).toBe(true);
  });
});

describe("pesan galat pipeline (docs/05 §4.1)", () => {
  it("keempat kode 409 punya kalimat Indonesia yang bisa dibaca", () => {
    for (const code of [
      "prereq_no_universe",
      "prereq_no_prices",
      "gate_weekly_not_final",
      "gate_midday_stale",
    ]) {
      const text = errorMessage(new ApiError(409, code, "raw backend message"));
      expect(text).toBe(ERROR_LABEL[code]);
      expect(text).not.toMatch(/raw backend message|_/); // tidak menampilkan kode mentah
    }
  });

  it("kode tak dikenal tetap menampilkan pesan backend, bukan crash", () => {
    expect(errorMessage(new ApiError(500, "boom", "DB terkunci"))).toBe("DB terkunci (boom)");
    expect(errorMessage(new Error("gagal jaringan"))).toBe("gagal jaringan");
  });

  it("reason baris gagal import diterjemahkan", () => {
    expect(importReasonLabel("invalid_ticker")).toBe("Kode saham tidak valid");
    expect(importReasonLabel("missing_ticker")).toBe("Kode saham kosong");
    expect(importReasonLabel("duplicate_row")).toBe("Baris duplikat (kode sudah ada)");
    expect(importReasonLabel("sesuatu_yang_baru")).toBe("sesuatu_yang_baru");
  });

  it("run tengah hari yang dilewati menjelaskan gate-nya, bukan error", () => {
    const middayRun = run(4, RUN_KIND.midday, "skipped", {
      result_json: { gate: "stale", last_bar_at: "2026-10-13T11:05:00+07:00", computed: false },
    });
    expect(skippedMessage(middayRun)).toBe(
      "Data Yahoo belum sampai sesi 1 (bar terakhir 11:05 WIB, syarat 11:30 WIB). Coba lagi nanti.",
    );
  });
});
