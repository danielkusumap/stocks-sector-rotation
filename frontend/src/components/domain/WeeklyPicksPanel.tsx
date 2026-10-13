import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import type { WeeklyPicksResponse, WeeklySectorPick, WeeklyStockPick } from "../../lib/api";
import { formatNum, formatRp } from "../../lib/format";
import { ruleRows, weekRangeLabel, type WeeklyScope } from "../../lib/weeklyPicks";
import { EmptyState } from "../ui/EmptyState";
import { StreakBadge } from "../ui/StreakBadge";

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
              />
              <RuleList hits={pick.rule_hits} />
            </details>
          ))}
        </Block>
      )}
    </div>
  );
}

/** entry/stop/target selalu monospace (docs/06 §5); `null` → "—" dari `lib/format`. */
function StockFigures({ pick }: { pick: WeeklyStockPick }) {
  return (
    <span className="font-mono text-sm tabular-nums">
      entry {formatRp(pick.entry_ref)} · stop {formatRp(pick.stop)} · target {formatRp(pick.target)}
      {pick.lots_hint !== null && ` · ${formatNum(pick.lots_hint)} lot`}
      {` · skor ${formatNum(pick.score, 1)}`}
    </span>
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
}: {
  rank: number;
  title: string;
  subtitle: string;
  streak: number;
  rationale: string;
  figures: ReactNode;
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
