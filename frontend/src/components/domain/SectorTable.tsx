import type { Dir, SectorSort, SectorSummaryItem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNum, formatRpCompact } from "../../lib/format";
import { streakLabel } from "../../lib/labels";
import { SECTOR_COLUMNS, nextSort } from "../../lib/sectorTable";
import { Delta } from "../ui/Delta";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { QuadrantBadge } from "../ui/QuadrantBadge";
import { StreakBadge } from "../ui/StreakBadge";
import { Table, Td, Th } from "../ui/Table";

/**
 * Tabel sektor (docs/06 §5): 12 kolom, header sticky, baris terpilih di-highlight dan
 * dipakai bersama chart lewat satu `selectedRefId` (docs/06 §6.1). Angka apa adanya
 * dari `/sectors/summary`; hanya pemisah ribuan & satuan ringkas yang ditambahkan.
 */
export function SectorTable({
  items,
  total,
  sort,
  dir,
  onSort,
  selectedRefId,
  onSelect,
  onResetFilters,
}: {
  items: SectorSummaryItem[];
  total: number;
  sort: SectorSort | string;
  dir: Dir;
  onSort: (next: { sort: SectorSort; dir: Dir }) => void;
  selectedRefId: string | null;
  onSelect: (code: string) => void;
  onResetFilters: () => void;
}) {
  return (
    <Table caption="Sektor: kuadran, umur, RS-Ratio, RS-Momentum, perubahan, return, turnover, streak, skor">
      <thead>
        <tr>
          {SECTOR_COLUMNS.map((column) => {
            const next = nextSort({ sort, dir }, column);
            return (
              <Th
                key={column.key}
                align={column.align}
                title={column.hint}
                sortable={Boolean(next)}
                active={column.sort === sort}
                dir={dir}
                onSort={next ? () => onSort(next) : undefined}
                className="sticky top-0 z-10"
              >
                {column.label}
              </Th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <Td colSpan={SECTOR_COLUMNS.length}>
              <EmptyState
                title="Tidak ada sektor yang cocok"
                hint="Longgarkan filter, atau kembali ke semua lingkup."
                action={<Button onClick={onResetFilters}>Reset filter</Button>}
              />
            </Td>
          </tr>
        ) : (
          items.map((item) => {
            const selected = item.code === selectedRefId;
            return (
              <tr
                key={item.code}
                data-testid={`sector-row-${item.code}`}
                data-selected={selected}
                onClick={() => onSelect(item.code)}
                className={cn(
                  "cursor-pointer hover:bg-surface-hover",
                  selected && "bg-accent-subtle hover:bg-accent-subtle",
                )}
              >
                <Td>
                  <button
                    type="button"
                    aria-label={`Pilih sektor ${item.name_id}`}
                    onClick={(event) => {
                      // baris juga memilih; jangan sampai dua kali
                      event.stopPropagation();
                      onSelect(item.code);
                    }}
                    className="flex items-center gap-2 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color_hex }}
                    />
                    <span className="font-medium">{item.name_id}</span>
                  </button>
                </Td>
                <Td>
                  <QuadrantBadge quadrant={item.quadrant} />
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {item.quadrant_age_periods}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(item.rs_ratio, 2)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(item.rs_momentum, 2)}
                </Td>
                <Td align="right">
                  <Delta value={item.rs_ratio_change_1p} unit="plain" />
                </Td>
                <Td align="right">
                  <Delta value={item.ret_1w} />
                </Td>
                <Td align="right">
                  <Delta value={item.ret_1m} />
                </Td>
                <Td align="right">
                  <Delta value={item.ret_3m} />
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatRpCompact(item.turnover_idr)}
                </Td>
                <Td align="right">
                  {streakLabel(item.streak_weeks) ? (
                    <StreakBadge weeks={item.streak_weeks} />
                  ) : (
                    <span className="text-fg-faint">—</span>
                  )}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(item.score, 1)}
                </Td>
              </tr>
            );
          })
        )}
      </tbody>
      <tfoot>
        <tr>
          <Td colSpan={SECTOR_COLUMNS.length} className="text-sm text-fg-muted">
            {items.length === 0
              ? `0 dari ${total} sektor`
              : `menampilkan ${items.length} dari ${total} sektor`}
          </Td>
        </tr>
      </tfoot>
    </Table>
  );
}
