import { X } from "lucide-react";
import type { Quadrant, SectorMeta } from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  FILTER_PRESETS,
  QUADRANT_OPTIONS,
  TURNOVER_PRESETS,
  WEIGHTING_OPTIONS,
  activeChips,
  toggleQuadrant,
  toggleSector,
} from "../../lib/filters";
import { QUADRANT_LABEL } from "../../lib/quadrant";
import type { FilterState } from "../../lib/urlFilters";
import type { FilterPatch } from "../../hooks/useFilterState";
import { Button } from "../ui/Button";
import { Popover } from "../ui/Popover";
import { Select } from "../ui/Select";

const labelClass = "text-xs font-medium tracking-[0.04em] text-fg-muted uppercase";

/**
 * `FilterBar` (docs/06 §5 + §7): chip filter aktif yang bisa dihapus satu-satu, tombol
 * "Filter" (popover berisi penyaring), preset cepat, dan "Reset". Semua nilai ditulis
 * ke URL oleh pemanggil — komponen ini tidak menyimpan state sendiri.
 *
 * Kontrol **lingkup** (Timeframe + Jendela) pindah ke topbar `AppShell`
 * (docs/08 F13 B) supaya tidak ada dua tempat untuk nilai yang sama; chip-nya tetap
 * muncul di sini dan tetap bisa dihapus.
 */
export function FilterBar({
  filters,
  setFilters,
  resetFilters,
  sectors,
  shown,
  total,
  className,
}: {
  filters: FilterState;
  setFilters: (patch: FilterPatch) => void;
  resetFilters: () => void;
  sectors: SectorMeta[];
  shown: number;
  total: number;
  className?: string;
}) {
  const names: Record<string, string> = {};
  for (const sector of sectors) names[sector.code] = sector.name_id;
  const chips = activeChips(filters, names);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-b border-border px-3 py-2", className)}>
      <Popover
        align="start"
        className="w-[540px]"
        trigger={
          <Button variant="outline">
            Filter{chips.length > 0 ? ` (${chips.length})` : ""}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className={labelClass}>Pembobotan</legend>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label="Pembobotan"
                value={filters.weighting}
                onChange={(value) => setFilters({ weighting: value })}
                options={WEIGHTING_OPTIONS}
              />
            </div>
            <p className="text-sm text-fg-faint">
              Timeframe &amp; jendela ada di topbar. Jendela hanya mengubah panjang ekor &amp; kolom
              return, tidak mengubah kuadran.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
            <legend className={labelClass}>Penyaring</legend>
            <div className="flex flex-wrap gap-1.5">
              {QUADRANT_OPTIONS.map((quadrant: Quadrant) => {
                const on = filters.quadrant.includes(quadrant);
                return (
                  <button
                    key={quadrant}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilters((prev) => toggleQuadrant(prev, quadrant))}
                    className={cn(
                      "h-7 rounded-sm border px-2.5 text-base",
                      on
                        ? "border-border-strong bg-accent-subtle font-medium text-fg"
                        : "border-border text-fg-muted hover:text-fg",
                    )}
                  >
                    {QUADRANT_LABEL[quadrant]}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                streak ≥
                <input
                  type="number"
                  min={0}
                  max={8}
                  aria-label="Streak minimal"
                  value={filters.min_streak}
                  onChange={(event) => setFilters({ min_streak: Number(event.target.value) || 0 })}
                  className="h-8 w-16 rounded-sm border border-border-strong bg-surface px-2 font-mono text-base text-fg"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={filters.ret_positive_only}
                  onChange={(event) => setFilters({ ret_positive_only: event.target.checked })}
                />
                hanya return positif
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-fg-muted">Likuiditas ≥</span>
              {TURNOVER_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={filters.min_turnover_idr === preset.value}
                  onClick={() =>
                    setFilters({ min_turnover_idr: preset.value === 0 ? null : preset.value })
                  }
                  className={cn(
                    "h-7 rounded-sm border px-2 font-mono text-base",
                    filters.min_turnover_idr === preset.value ||
                      (preset.value === 0 && filters.min_turnover_idr === null)
                      ? "border-border-strong bg-accent-subtle text-fg"
                      : "border-border text-fg-muted hover:text-fg",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">Sektor</legend>
              <span className={labelClass}>Sektor</span>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
                {sectors.map((sector) => (
                  <label key={sector.code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filters.sector.includes(sector.code)}
                      onChange={() => setFilters((prev) => toggleSector(prev, sector.code))}
                    />
                    {sector.name_id}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
        </div>
      </Popover>

      {FILTER_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="ghost"
          onClick={() => setFilters(preset.patch)}
          data-testid={`preset-${preset.id}`}
        >
          {preset.label}
        </Button>
      ))}

      <span className="text-sm text-fg-muted" data-testid="filter-count">
        {shown} dari {total} sektor
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.key}
            data-testid={`chip-${chip.key}`}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-bg-subtle pl-2 text-sm text-fg"
          >
            {chip.label}
            <button
              type="button"
              aria-label={`Hapus filter ${chip.label}`}
              onClick={() => setFilters(chip.patch)}
              className="flex h-7 w-6 items-center justify-center text-fg-muted hover:text-fg"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ))}
        {chips.length > 0 && (
          <Button variant="ghost" onClick={resetFilters} data-testid="reset-filters">
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
