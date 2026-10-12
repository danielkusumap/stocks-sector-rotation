import { describe, expect, it } from "vitest";
import { RUN_KIND } from "../lib/pipeline";
import { resultFor } from "./admin";

/**
 * Kontrak `docs/05` §4.6: nama `run.kind` baku ("beda satu huruf = tombol selalu belum pernah")
 * dan bentuk `result_json` per kind.
 */
describe("nama run.kind (docs/05 §4.6)", () => {
  it("persis enam nilai, tanpa tambahan", () => {
    expect(Object.values(RUN_KIND).sort()).toEqual([
      "compute_all",
      "compute_signals",
      "import_excel",
      "midday",
      "prices_daily",
      "prices_intraday",
    ]);
  });
});

describe("bentuk result_json per kind (docs/05 §4.6)", () => {
  const shapes: [string, string[]][] = [
    [RUN_KIND.importExcel, ["import_id", "inserted", "updated", "deactivated", "errors"]],
    [RUN_KIND.pricesDaily, ["rows", "batches", "failed_tickers"]],
    [RUN_KIND.pricesIntraday, ["rows", "batches", "failed_tickers"]],
    [RUN_KIND.computeAll, ["timeframe", "sectors", "tickers", "duration_s"]],
    [RUN_KIND.computeSignals, ["week_end", "sectors", "stocks"]],
    [RUN_KIND.midday, ["gate", "last_bar_at", "computed"]],
  ];

  it.each(shapes)("%s → kunci %j", (kind, keys) => {
    expect(Object.keys(resultFor(kind, false) as object).sort()).toEqual([...keys].sort());
  });

  it("midday yang stale tidak mengaku sudah dihitung", () => {
    const result = resultFor(RUN_KIND.midday, true) as { gate: string; computed: boolean };
    expect(result.gate).toBe("stale");
    expect(result.computed).toBe(false);
  });
});
