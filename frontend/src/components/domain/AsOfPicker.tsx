import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Timeframe } from "../../lib/api";
import {
  DAY_NAMES,
  asOfLabel,
  monthGrid,
  monthKey,
  monthLabel,
  shiftMonth,
} from "../../lib/calendar";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { useMetaDates } from "../../hooks/useApiQuery";
import { Button } from "../ui/Button";
import { Popover } from "../ui/Popover";

/**
 * `AsOfPicker` (docs/06 §5): tanggal acuan. Hari yang tidak ada di `GET /meta/dates`
 * (libur bursa / belum dihitung) **dinonaktifkan** — tombolnya `disabled`, jadi tidak ada
 * request yang terkirim. Kalau daftar tanggal kosong (`latest: null`) picker jatuh ke
 * `<input type="date">` biasa dan user tidak diblokir (docs/05 §1).
 */
export function AsOfPicker({
  value,
  onChange,
  timeframe,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  timeframe: Timeframe;
}) {
  const meta = useMetaDates({ timeframe, limit: 120 });
  const dates = meta.data?.dates ?? [];
  const latest = meta.data?.latest ?? null;
  const available = new Set(dates);
  const [month, setMonth] = useState(() => monthKey(value ?? latest ?? new Date().toISOString()));
  const [open, setOpen] = useState(false);

  // daftar kosong = belum ada hasil hitung → input tanggal biasa, bukan error (docs/05 §1)
  if (meta.isSuccess && dates.length === 0) {
    return (
      <label className="flex items-center gap-1.5 text-sm text-fg-muted">
        <CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">Tanggal acuan</span>
        <input
          type="date"
          aria-label="Tanggal acuan"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          className="h-7 rounded-sm border border-border-strong bg-surface px-1.5 text-base text-fg"
        />
      </label>
    );
  }

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <Popover
      align="end"
      open={open}
      onOpenChange={setOpen}
      className="w-64"
      trigger={
        <Button variant="ghost" aria-label="Tanggal acuan" data-testid="asof-trigger">
          <CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />
          {meta.isPending ? "memuat tanggal…" : `as of ${asOfLabel(value, latest)}`}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Bulan sebelumnya"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-sm p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <ChevronLeft size={14} strokeWidth={1.75} />
          </button>
          <p className="text-sm font-medium" data-testid="asof-month">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            aria-label="Bulan berikutnya"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="rounded-sm p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <ChevronRight size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center">
          {DAY_NAMES.map((day) => (
            <span key={day} className="text-xs text-fg-faint">
              {day}
            </span>
          ))}
          {monthGrid(month).map((iso, index) => {
            if (!iso) return <span key={`kosong-${index}`} />;
            const hasData = available.has(iso);
            const selected = iso === value;
            return (
              <button
                key={iso}
                type="button"
                disabled={!hasData}
                data-testid={`asof-day-${iso}`}
                data-available={hasData}
                aria-pressed={selected}
                title={hasData ? formatDate(iso) : `${formatDate(iso)} — tidak ada data`}
                onClick={() => pick(iso)}
                className={cn(
                  "h-7 rounded-sm font-mono text-sm tabular-nums",
                  hasData ? "text-fg hover:bg-surface-hover" : "cursor-not-allowed text-fg-faint line-through",
                  selected && "bg-accent-subtle font-medium",
                )}
              >
                {Number(iso.slice(8, 10))}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-sm text-fg-muted">
            {latest ? `terbaru ${formatDate(latest)}` : "belum ada hasil hitung"}
          </span>
          {value && (
            <Button variant="ghost" onClick={() => pick("")} data-testid="asof-latest">
              Pakai terbaru
            </Button>
          )}
        </div>
      </div>
    </Popover>
  );
}
