import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import type { WeeklyPicksResponse, WeeklyPlan, WeeklySectorPick, WeeklyStockPick } from "../../lib/api";
import { formatNum, formatRp } from "../../lib/format";
import {
  planRows,
  planStateLabel,
  planSummary,
  regimeTone,
  REGIME_LABEL,
  ruleRows,
  weekRangeLabel,
  type WeeklyScope,
} from "../../lib/weeklyPicks";
import { EmptyState } from "../ui/EmptyState";
import { StreakBadge } from "../ui/StreakBadge";
import { cn } from "../../lib/cn";

/**
 * `WeeklyPicksPanel` (docs/06 §5): blok SEKTOR & SAHAM dari `GET /weekly/picks`.
 * Angka (rank, skor, entry/stop/target) ditampilkan apa adanya — tidak ada yang
 * dihitung di sini (docs/08 aturan 1). Expander "kenapa?" membuka SELURUH
 * `rule_hits`, termasuk yang gagal (docs/08 F9 AC: itu inti transparansinya).
 */
export function WeeklyPicksPanel({
  data,
  scope,
}: {
  data: WeeklyPicksResponse;
  scope: WeeklyScope;
}) {
  // minggu berjalan belum punya sinyal final → tidak ada kandidat, dan itu bukan error
  const sectors = data.is_final ? data.sectors : [];
  const stocks = data.is_final ? data.stocks : [];

  return (
    <div className="flex flex-col" data-testid="weekly-picks">
      {!data.is_final && (
        <div
          data-testid="weekly-not-final"
          className="flex flex-col gap-1 border-b border-border bg-bg-subtle px-3 py-2.5"
        >
          <p className="font-medium">Pekan {weekRangeLabel(data.week_end)} belum final</p>
          <p className="text-sm text-fg-muted">
            Belum final, tersedia setelah penutupan Jumat — sinyal minggu berjalan baru dihitung
            setelah sesi Jumat ditutup.
          </p>
        </div>
      )}

      {scope !== "stock" && (
        <Block title="SEKTOR" count={sectors.length}>
          {sectors.map((pick) => (
            <details
              key={pick.ref_id}
              data-testid={`pick-sector-${pick.ref_id}`}
              data-streak={pick.streak_weeks}
              className="border-b border-border last:border-b-0"
            >
              <PickSummary
                rank={pick.rank}
                title={pick.name}
                subtitle={pick.ref_id}
                streak={pick.streak_weeks}
                rationale={pick.rationale}
                figures={
                  <>
                    skor <span className="font-mono tabular-nums">{formatNum(pick.score, 1)}</span>
                  </>
                }
              />
              <RuleList hits={pick.rule_hits} />
            </details>
          ))}
        </Block>
      )}

      {scope !== "sector" && (
        <Block title="SAHAM" count={stocks.length}>
          {stocks.map((pick) => (
            <details
              key={pick.ticker}
              data-testid={`pick-stock-${pick.ticker}`}
              data-streak={pick.streak_weeks}
              className="border-b border-border last:border-b-0"
            >
              <PickSummary
                rank={pick.rank}
                title={pick.ticker}
                subtitle={`${pick.name} · ${pick.sector_code}`}
                streak={pick.streak_weeks}
                rationale={pick.rationale}
                figures={<StockFigures pick={pick} />}
                regime={pick.plan ? pick.plan.regime : null}
                state={planStateLabel(pick.plan)}
                notes={pick.plan && !pick.plan.plan_ok ? pick.plan.notes : []}
              />
              <RuleList hits={pick.rule_hits} />
              <PlanBlock ticker={pick.ticker} plan={pick.plan ?? null} />
            </details>
          ))}
        </Block>
      )}
    </div>
  );
}

/**
 * Angka baris pick (docs/06 §5.2): kalau `plan` ada, satu baris monospace dari `planSummary`
 * (zona/SL/TP1/TP2/R:R) — angka dari API, tidak ada yang dihitung di sini. `plan` null →
 * kembali ke entry/stop/target lama supaya F9 tetap utuh.
 */
function StockFigures({ pick }: { pick: WeeklyStockPick }) {
  const summary = planSummary(pick.plan);
  return (
    <span className="font-mono text-sm tabular-nums" data-testid="pick-figures-line">
      {summary ?? (
        <>
          entry {formatRp(pick.entry_ref)} · stop {formatRp(pick.stop)} · target {formatRp(pick.target)}
        </>
      )}
      {pick.lots_hint !== null && ` · ${formatNum(pick.lots_hint)} lot`}
      {` · skor ${formatNum(pick.score, 1)}`}
    </span>
  );
}

/** Badge rezim + label keadaan; `notes` tampil di baris saat `plan_ok = false` (docs/08 F18 AC 5). */
function PlanBadges({
  regime,
  state,
  notes,
}: {
  regime: string | null;
  state: string | null;
  notes: string[];
}) {
  if (!regime && !state) return null;
  const tone = regime ? regimeTone(regime) : "neutral";
  const toneClass =
    tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-fg-muted";
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-sm">
      {regime && (
        <span data-testid="plan-regime" data-tone={tone} className={cn("font-medium", toneClass)}>
          {REGIME_LABEL[regime] ?? regime}
        </span>
      )}
      {state && (
        <span data-testid="plan-state" className="text-warn">
          {state}
        </span>
      )}
      {notes.length > 0 && (
        <span data-testid="plan-notes" className="text-warn">
          {notes.join(" ")}
        </span>
      )}
    </span>
  );
}

/** Blok plan terbuka (expander kedua, setelah "kenapa?"): baris `docs/06` §5.2 no. 1–7. */
function PlanBlock({ ticker, plan }: { ticker: string; plan: WeeklyPlan | null }) {
  if (!plan) {
    return (
      <p data-testid={`plan-${ticker}`} className="px-3 pb-2.5 pl-8 text-sm text-fg-faint">
        plan belum tersedia untuk pekan ini.
      </p>
    );
  }
  const rows = planRows(plan);
  return (
    <details data-testid={`plan-${ticker}`} className="pb-2.5 pl-8">
      <summary className="cursor-pointer text-sm text-fg-muted">plan</summary>
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
      {plan.notes.length > 0 && (
        <ul data-testid="plan-notes-list" className="mt-1 flex flex-col gap-0.5 text-sm text-warn">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Block({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={`weekly-block-${title.toLowerCase()}`}
      className="flex flex-col border-b border-border last:border-b-0"
    >
      <h3 className="flex h-8 items-center gap-2 bg-bg-subtle px-3 text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
        {title}
        <span className="font-mono tracking-normal text-fg-faint">{count}</span>
      </h3>
      {count === 0 ? (
        <EmptyState
          title="Belum ada kandidat"
          hint="Tidak ada yang lolos pada pekan ini. Longgarkan filter streak, atau pilih pekan lain."
        />
      ) : (
        children
      )}
    </section>
  );
}

/** Satu baris pick: `<details>` supaya expander "kenapa?" bisa keyboard tanpa state sendiri. */
function PickSummary({
  rank,
  title,
  subtitle,
  streak,
  rationale,
  figures,
  regime = null,
  state = null,
  notes = [],
}: {
  rank: number;
  title: string;
  subtitle: string;
  streak: number;
  rationale: string;
  figures: ReactNode;
  regime?: string | null;
  state?: string | null;
  notes?: string[];
}) {
  return (
    <summary className="flex cursor-pointer flex-col gap-1 px-3 py-2 hover:bg-surface-hover">
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-5 shrink-0 font-mono text-sm tabular-nums text-fg-muted">{rank}</span>
        <span className="font-medium">{title}</span>
        <span className="font-mono text-sm text-fg-muted">{subtitle}</span>
        {/* pembungkus tanpa gaya: `StreakBadge` sendiri `null` saat streak < 2 (AC F9) */}
        <span data-testid="pick-streak" data-weeks={streak}>
          <StreakBadge weeks={streak} />
        </span>
        <PlanBadges regime={regime} state={state} notes={notes} />
        <span data-testid="pick-figures" className="ml-auto text-sm text-fg">
          {figures}
        </span>
        <span className="shrink-0 text-sm text-fg-muted">kenapa?</span>
      </span>
      <span className="text-sm text-fg-muted">{rationale}</span>
    </summary>
  );
}

function RuleList({ hits }: { hits: WeeklySectorPick["rule_hits"] | WeeklyStockPick["rule_hits"] }) {
  return (
    <ul data-testid="rule-hits" className="flex flex-col gap-1 px-3 pt-1 pb-2.5 pl-8">
      {ruleRows(hits).map((rule) => (
        <li
          key={rule.key}
          data-rule={rule.key}
          data-ok={rule.ok === null ? "info" : String(rule.ok)}
          data-known={rule.known}
          className="flex items-baseline gap-2 text-sm"
        >
          <RuleIcon ok={rule.ok} />
          {/* key asing dari backend: tampil apa adanya, tanpa warna peringatan */}
          <span className={rule.ok === false && rule.known ? "text-warn" : "text-fg-muted"}>
            {rule.label}
            {rule.ok !== null && (
              <span className="sr-only">{rule.ok ? " — lolos" : " — belum lolos"}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RuleIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <Minus size={14} strokeWidth={1.75} aria-hidden="true" className="text-fg-faint" />;
  }
  return ok ? (
    <Check size={14} strokeWidth={1.75} aria-hidden="true" className="text-fg-muted" />
  ) : (
    <X size={14} strokeWidth={1.75} aria-hidden="true" className="text-warn" />
  );
}
