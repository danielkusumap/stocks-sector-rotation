import { useLocation, useNavigate } from "react-router";
import type { Dir, StockRow, StockSort } from "../../lib/api";
import { formatNum, formatRp, formatRpCompact } from "../../lib/format";
import { STOCK_COLUMNS, nextSort, pageOf, pageCount, rangeLabel, type StockColumn } from "../../lib/stockTable";
import { breakoutCellText, periodsText, resultLabel, resultTone, summaryMap, winRateText } from "../../lib/taTable";
import { useTaSummary } from "../../hooks/useApiQuery";
import { Button } from "../ui/Button";
import { Delta } from "../ui/Delta";
import { EmptyState } from "../ui/EmptyState";
import { Pill } from "../ui/Pill";
import { QuadrantBadge } from "../ui/QuadrantBadge";
import { Table, Td, Th } from "../ui/Table";

/**
 * `StockTable` (docs/06 §5): kolom seperti `SectorTable` + Ticker/Nama/Harga/RSI/ATR/Skor.
 * Sorting dari header (lewat API), paginasi `limit`/`offset`, baris klik → `/stocks/{ticker}`.
 */
export function StockTable({
  items,
  total,
  limit,
  offset,
  sort,
  dir,
  onSort,
  onPage,
  onResetFilters,
}: {
  items: StockRow[];
  total: number;
  limit: number;
  offset: number;
  sort: StockSort | string;
  dir: Dir;
  onSort: (column: StockColumn) => void;
  onPage: (offset: number) => void;
  onResetFilters: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const page = pageOf(offset, limit);
  const pages = pageCount(total, limit);
  // bawa filter URL ke halaman detail supaya tombol "← Semua saham" kembali ke tabel yang sama
  const detailHref = (ticker: string) => `/stocks/${ticker}${location.search}`;
  // Kolom insight (docs/08 F17): **satu** permintaan `/ta/summary` untuk seluruh halaman.
  // shortcut: maks 500 baris pertama dari `/ta/summary`; baris di luar itu tampil "—".
  const ta = useTaSummary({ scope: "stock", limit: 500 });
  const taRows = summaryMap(ta.data?.items);

  return (
    <div>
      <Table caption="Saham: harga, kuadran, RS, return, RSI, ATR, turnover, skor, analisa teknikal">
        <thead>
          <tr>
            {STOCK_COLUMNS.map((column) => {
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
              <Td colSpan={STOCK_COLUMNS.length}>
                <EmptyState
                  title="Tidak ada saham yang cocok"
                  hint="Longgarkan filter, atau kosongkan kata kunci pencarian."
                  action={<Button onClick={onResetFilters}>Reset filter</Button>}
                />
              </Td>
            </tr>
          ) : (
            items.map((row) => (
              <tr
                key={row.ticker}
                data-testid={`stock-row-${row.ticker}`}
                onClick={() => navigate(detailHref(row.ticker))}
                className="cursor-pointer hover:bg-surface-hover"
              >
                <Td>
                  <button
                    type="button"
                    aria-label={`Buka detail ${row.ticker}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(detailHref(row.ticker));
                    }}
                    className="font-medium text-accent hover:underline"
                  >
                    {row.ticker}
                  </button>
                </Td>
                <Td>{row.name}</Td>
                <Td>
                  <QuadrantBadge quadrant={row.quadrant} />
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(row.rs_ratio, 2)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(row.rs_momentum, 2)}
                </Td>
                <Td align="right">
                  <Delta value={row.ret_1d} />
                </Td>
                <Td align="right">
                  <Delta value={row.ret_1w} />
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatRp(row.close)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(row.rsi14, 1)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatRp(row.atr14)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatRpCompact(row.median_turnover_20d_idr)}
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {formatNum(row.stock_score, 1)}
                </Td>
                {/* kolom insight TA (docs/08 F17) — angka dari `/ta/summary` */}
                <Td align="right" className="font-mono tabular-nums">
                  <span data-testid={`ta-win-${row.ticker}`}>
                    {winRateText(taRows.get(row.ticker)?.win_rate)}
                  </span>
                </Td>
                <Td align="right" className="font-mono tabular-nums">
                  {periodsText(taRows.get(row.ticker)?.median_periods_win)}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  <span data-testid={`ta-breakout-${row.ticker}`}>
                    {(() => {
                      const insight = taRows.get(row.ticker);
                      const breakout = insight ? breakoutCellText(insight) : null;
                      if (!breakout || !insight?.last_breakout) return <span className="text-fg-faint">—</span>;
                      return (
                        <>
                          {breakout}{" "}
                          <Pill
                            tone={resultTone(insight.last_breakout.result)}
                            label={resultLabel(insight.last_breakout.result)}
                          />
                        </>
                      );
                    })()}
                  </span>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-sm text-fg-muted" data-testid="stock-range">
          {rangeLabel(offset, items.length, total)}
        </span>
        <span className="text-sm text-fg-faint" data-testid="stock-page">
          halaman {page} dari {pages}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            data-testid="stock-prev"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(0, offset - limit))}
          >
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            data-testid="stock-next"
            disabled={page >= pages}
            onClick={() => onPage(offset + limit)}
          >
            Berikutnya
          </Button>
        </div>
      </div>
    </div>
  );
}
