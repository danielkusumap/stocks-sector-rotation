import { usePlanPicks } from "../../hooks/useApiQuery";
import { formatNum } from "../../lib/format";
import { cn } from "../../lib/cn";
import { TONE_CLASS, runningGroups } from "../../lib/swingPicks";

/**
 * Seksi **"Pantau yang berjalan"** (docs/08 F25 butir 6): pick dari hari-hari sebelumnya,
 * dikelompokkan per status. Datanya diambil **setelah** halaman idle (`ready`) supaya pembukaan
 * halaman tetap satu permintaan (AC 2/9); tiap tanggal punya cache sendiri (`staleTime` 5 menit).
 */
export function RunningWatch({
  dates,
  ready,
  onPickDate,
  highlighted,
}: {
  /** Tanggal lain (bukan tanggal aktif) yang bisa dipantau, dari `available_dates`. */
  dates: readonly string[];
  ready: boolean;
  onPickDate: (date: string) => void;
  highlighted: string | null;
}) {
  if (dates.length === 0) return null;
  return (
    <section data-testid="running-watch" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Pantau yang berjalan</h2>
      {ready ? (
        dates.map((date) => (
          <RunningDay key={date} date={date} onPickDate={onPickDate} highlighted={highlighted} />
        ))
      ) : (
        <p className="text-sm text-fg-muted">memuat pick hari sebelumnya…</p>
      )}
    </section>
  );
}

function RunningDay({
  date,
  onPickDate,
  highlighted,
}: {
  date: string;
  onPickDate: (date: string) => void;
  highlighted: string | null;
}) {
  const query = usePlanPicks({ as_of: date });
  const pickList = query.data?.picks ?? [];
  const groups = runningGroups([{ date, picks: pickList }]);

  if (pickList.length === 0) {
    return (
      <p className="text-sm text-fg-faint" data-testid={`running-empty-${date}`}>
        {date}: tidak ada pick tersimpan.
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-fg-muted" data-testid={`running-waiting-${date}`}>
        {date}: {formatNum(pickList.length)} pick masih menunggu zona.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid={`running-day-${date}`}>
      {groups.map((group) => (
        <div key={group.status} className="flex flex-wrap items-baseline gap-2" data-testid={`running-group-${group.status}`}>
          <span className={cn("text-sm", TONE_CLASS[group.tone])}>
            {group.label} · {formatNum(group.items.length)}
          </span>
          {group.items.map((item) => (
            <button
              key={`${item.date}-${item.ticker}`}
              type="button"
              data-testid={`running-pick-${item.ticker}`}
              title={item.note ?? undefined}
              onClick={() => onPickDate(item.date)}
              className={cn(
                "inline-flex h-6 items-center rounded-sm border border-border px-1.5 font-mono text-sm",
                item.ticker === highlighted ? "bg-accent-subtle text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {item.ticker}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
