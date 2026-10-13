import { useSearchParams } from "react-router";
import { WeeklyPicksPanel } from "../components/domain/WeeklyPicksPanel";
import { ErrorState } from "../components/ui/ErrorState";
import { Panel } from "../components/ui/Panel";
import { Segmented } from "../components/ui/Segmented";
import { Select } from "../components/ui/Select";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useMetaDates, useWeeklyPicks } from "../hooks/useApiQuery";
import {
  WEEKLY_SCOPE_LABEL,
  WEEKLY_SCOPES,
  jakartaToday,
  readWeeklyParams,
  weekEndOf,
  weekOptions,
  weekRangeLabel,
  writeWeeklyParams,
} from "../lib/weeklyPicks";

/** Nilai 0–8 sesuai docs/06 §7; 0 = tanpa saringan streak. */
const STREAK_OPTIONS = Array.from({ length: 9 }, (_, value) => ({
  value: String(value),
  label: value === 0 ? "semua streak" : `streak ≥ ${value}`,
}));

const SCOPE_OPTIONS = WEEKLY_SCOPES.map((value) => ({ value, label: WEEKLY_SCOPE_LABEL[value] }));

/**
 * F9 — /weekly. Kandidat mingguan dari `GET /weekly/picks`; `week_end`, `min_streak`,
 * dan `scope` hidup di URL (docs/08 aturan 4). Pemilih pekan memakai `meta/dates`
 * (Jumat yang sudah punya hasil hitung) + pekan berjalan yang belum final.
 */
export default function WeeklyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = readWeeklyParams(searchParams);
  const setParams = (patch: Parameters<typeof writeWeeklyParams>[1]) =>
    setSearchParams(writeWeeklyParams(searchParams, patch), { replace: true });

  const picks = useWeeklyPicks({
    week_end: params.week_end ?? undefined,
    scope: params.scope,
    min_streak: params.min_streak,
  });
  const dates = useMetaDates({ timeframe: "w1_fri", limit: 52 });

  const weeks = weekOptions({
    dates: dates.data?.dates ?? [],
    running: weekEndOf(jakartaToday()),
    selected: picks.data?.week_end ?? null,
  });
  // tanpa `week_end` di URL: backend memilih minggu final terakhir (docs/05 §3)
  const selectedWeek = params.week_end ?? picks.data?.week_end ?? "";

  return (
    <Panel
      title="Fokus Mingguan"
      actions={
        picks.data ? (
          <span data-testid="weekly-week" className="text-sm text-fg-muted">
            pekan {weekRangeLabel(picks.data.week_end)} ·{" "}
            {picks.data.is_final ? "final" : "belum final"}
          </span>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">Pekan</span>
        <Select
          label="Pekan"
          value={selectedWeek}
          onChange={(value) => setParams({ week_end: value })}
          options={weeks}
          placeholder="memuat pekan…"
        />
        <Select
          label="Streak minimal"
          value={String(params.min_streak)}
          onChange={(value) => setParams({ min_streak: Number(value) })}
          options={STREAK_OPTIONS}
        />
        <Segmented
          label="Lingkup"
          options={SCOPE_OPTIONS}
          value={params.scope}
          onChange={(value) => setParams({ scope: value })}
        />
        <span className="text-sm text-fg-faint">
          pekan berjalan belum punya sinyal final → daftar kosong, bukan error
        </span>
      </div>

      {picks.isPending ? (
        <div className="p-3">
          <TableSkeleton rows={6} cols={5} />
        </div>
      ) : picks.isError ? (
        <ErrorState error={picks.error} onRetry={() => void picks.refetch()} />
      ) : (
        <WeeklyPicksPanel data={picks.data} scope={params.scope} />
      )}
    </Panel>
  );
}
