import type { Dir, SectorSort, SectorSummaryItem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNum, formatRpCompact } from "../../lib/format";
import { streakLabel } from "../../lib/labels";
import { SECTOR_COLUMNS, nextSort, type SectorColumn } from "../../lib/sectorTable";
import { breakoutCellText, periodsText, resultLabel, resultTone, summaryMap, winRateText } from "../../lib/taTable";
import { useTaSummary } from "../../hooks/useApiQuery";
import { Delta } from "../ui/Delta";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Pill } from "../ui/Pill";
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
  onSort: (column: SectorColumn) => void;
  selectedRefId: string | null;
  onSelect: (code: string) => void;
  onResetFilters: () => void;
}) {
  // Kolom insight (docs/08 F17): **satu** permintaan `/ta/summary` untuk seluruh halaman,
  // lalu dicocokkan per baris lewat `ref_id` — bukan satu permintaan per baris.
  // shortcut: `/ta/summary` mengirim maks 500 baris pertama, jadi baris di luar itu tampil "—";
  //           kalau suatu saat perlu semuanya, minta backend menerima daftar `ref_id`.
  const ta = useTaSummary({ scope: "sector", limit: 500 });
  const taRows = summaryMap(ta.data?.items);

  return (
    <Table caption="Sektor: kuadran, umur, RS-Ratio, RS-Momentum, perubahan, return, turnover, streak, skor, analisa teknikal">
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
                onSort={next ? () => onSort(column) : undefined}
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
            const insight = taRows.get(item.code);
            const breakout = insight ? breakoutCellText(insight) : null;
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
                {/* kolom insight TA (docs/08 F17) — angka dari `/ta/summary` */}
                <Td align="right" className="font-mono tabular-nums">
                  <span data-testid={`ta-win-${item.code}`}>{winRateText(insight?.win_rate)}</span>
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {periodsText(insight?.median_periods_win)}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  <span data-testid={`ta-breakout-${item.code}`}>
                    {breakout && insight?.last_breakout ? (
                      <>
                        {breakout}{" "}
                        <Pill
                          tone={resultTone(insight.last_breakout.result)}
                          label={resultLabel(insight.last_breakout.result)}
                        />
                      </>
                    ) : (
                      <span className="text-fg-faint">—</span>
                    )}
                  </span>
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
