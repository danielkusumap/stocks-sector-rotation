import type { StockPlanResponse } from "../../lib/api";
import { formatNum, formatRp } from "../../lib/format";
import { planRows, toolLabel } from "../../lib/weeklyPicks";
import {
  chance,
  coverageTextPlan,
  levelsRows,
  noTradeSentence,
  planStateLabel as planState,
  regimeLabel,
  regimeToneOf,
  scenarioRows,
  summaryLines,
} from "../../lib/stockAnalysis";
import { useStockPlan } from "../../hooks/useApiQuery";
import { ErrorState } from "../ui/ErrorState";
import { Panel } from "../ui/Panel";
import { Skeleton } from "../ui/Skeleton";

/**
 * Panel "Analisa teknikal" halaman detail saham (docs/06 §5.3, docs/08 F20) — berlaku untuk
 * **semua** emiten. Sumber tunggal `GET /plan/stock/{ticker}`: rezim, ringkasan, skenario
 * historis, plan, alat & alasan, daftar level, catatan cakupan. Semua angka dari API;
 * blok plan memakai `planRows` dari F18 (satu implementasi untuk Weekly & halaman saham).
 */
export function AnalysisPanel({ ticker, asOf }: { ticker: string; asOf?: string }) {
  const query = useStockPlan(ticker, asOf ? { as_of: asOf } : {});
  const data = query.data;

  return (
    <Panel
      title="Analisa teknikal"
      actions={
        data ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span
              data-testid="analysis-regime"
              data-tone={regimeToneOf(data.regime.code)}
              className={
                regimeToneOf(data.regime.code) === "down"
                  ? "font-medium text-down"
                  : regimeToneOf(data.regime.code) === "warn"
                    ? "font-medium text-warn"
                    : "font-medium text-fg-muted"
              }
            >
              {regimeLabel(data.regime.code)}
            </span>
            <span className="text-fg-faint">harga penyesuaian</span>
          </span>
        ) : null
      }
    >
      {query.isPending ? (
        // tinggi mendekati isi akhirnya (ringkasan + skenario + plan) → tanpa CLS
        <div className="flex flex-col gap-2 p-3" data-testid="analysis-skeleton">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : data ? (
        <AnalysisBody data={data} />
      ) : null}
    </Panel>
  );
}

function AnalysisBody({ data }: { data: StockPlanResponse }) {
  const lines = summaryLines(data.summary_lines);
  const scenario = scenarioRows(data.scenario);
  const state = planState(data.plan);
  const thin = data.regime.code === "tidak_cukup_data";
  const notes = data.plan?.notes ?? [];
  const rows = planRows(data.plan);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="analysis-panel">
      {/* 1. ringkasan (apa adanya dari API, 1–3 baris) */}
      <section data-testid="analysis-summary" className="flex flex-col gap-1 text-sm">
        {lines.length > 0 ? (
          lines.map((line) => <p key={line}>{line}</p>)
        ) : (
          <p className="text-fg-muted">belum ada ringkasan dari backend.</p>
        )}
      </section>

      {/* 2. skenario historis — hanya bila ada datanya & bukan regime tidak_cukup_data */}
      {!thin && (
        <section data-testid="analysis-scenario" className="border-t border-border pt-2">
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
            Skenario historis
          </h3>
          <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            {scenario.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-2">
                <dt className="text-fg-muted">{row.label}</dt>
                <dd className="font-mono tabular-nums" data-scenario={row.key}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {data.scenario && <p className="mt-1 text-sm text-fg-faint">{data.scenario.basis}</p>}
        </section>
      )}

      {/* 3. plan / tidak ada rencana beli / belum tersedia */}
      <section data-testid="analysis-plan" className="border-t border-border pt-2">
        <h3 className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
          Plan
          {state && (
            <span data-testid="analysis-plan-state" className="text-warn normal-case">
              {state}
            </span>
          )}
        </h3>

        {data.plan === null ? (
          <p className="mt-1 text-sm text-fg-faint" data-testid="analysis-plan-empty">
            plan belum tersedia untuk saham ini.
          </p>
        ) : data.plan.entry_mode === "no_trade" ? (
          <p className="mt-1 text-sm" data-testid="analysis-no-trade">
            {noTradeSentence(data.plan)}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {rows.map((row) => (
              <li key={row.key} data-plan-row={row.key} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-fg-muted">{row.label}</span>
                  <span className="font-mono tabular-nums">{row.value}</span>
                </span>
                {row.reason && <span className="text-fg-muted">{row.reason}</span>}
              </li>
            ))}
          </ul>
        )}

        {/* ekspektasi lama tahan + peluang historis (tanpa tanda) */}
        {data.plan && data.plan.entry_mode !== "no_trade" && (
          <p className="mt-1 text-sm text-fg-muted" data-testid="analysis-hold">
            {data.plan.hold.hit_tp1 === null
              ? "belum cukup riwayat"
              : `median ${formatNum(data.plan.hold.median_periods, 0)} bar · TP1 kena ${chance(
                  data.plan.hold.hit_tp1,
                )}${data.plan.hold.hit_tp2 === null ? "" : ` · TP2 kena ${chance(data.plan.hold.hit_tp2)}`}`}
          </p>
        )}

        {notes.length > 0 && (
          <ul data-testid="analysis-notes" className="mt-1 flex flex-col gap-0.5 text-sm text-warn">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. alat & alasan (rezim + alat aktif + alasan elemen yang tidak tampil di blok plan) */}
      <section data-testid="analysis-tools" className="border-t border-border pt-2 text-sm">
        <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">Alat &amp; alasan</h3>
        <ul className="mt-1 flex flex-col gap-0.5">
          {data.regime.active_tools.map((tool) => (
            <li key={tool} className="font-medium">
              {toolLabel(tool)}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-fg-muted">{data.regime.reason}</p>
        {data.plan && data.plan.entry_mode !== "no_trade" && (
          <p className="mt-1 text-fg-muted" data-testid="analysis-stop-reason">
            {data.plan.stop.reason}
          </p>
        )}
      </section>

      {/* 5. daftar level apa adanya (urutan dari backend) */}
      {!thin && (
        <section data-testid="analysis-levels" className="border-t border-border pt-2">
          <h3 className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">Daftar level</h3>
          <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            {levelsRows(data.levels_table).map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-2">
                <dt className="text-fg-muted">{row.label}</dt>
                <dd className="font-mono tabular-nums">{row.value}</dd>
              </div>
            ))}
            {data.price.close !== null && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-fg-muted">Harga terakhir</dt>
                <dd className="font-mono tabular-nums">{formatRp(data.price.close)}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* 6. catatan cakupan (wajib) */}
      <p className="border-t border-border pt-2 text-sm text-fg-faint" data-testid="analysis-coverage">
        {coverageTextPlan(data.coverage)}
      </p>

      {/* badge keadaan bila plan perlu ditinjau (teks sudah tampil di judul blok plan) */}
    </div>
  );
}
