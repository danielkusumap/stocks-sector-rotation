import type { HeatmapResponse } from "../../lib/api";
import { formatPct } from "../../lib/format";
import { heatmapAlpha, heatmapColumnLabel, heatmapScale, heatmapToken } from "../../lib/heatmap";
import { Table, Td, Th } from "../ui/Table";

/**
 * `HeatmapGrid` (docs/06 §5): 11 sektor × 4 periode. Warna latar dari `--up`/`--down`
 * dengan alpha 0,08–0,55, dan **angka selalu tampil** dengan tanda eksplisit — warna
 * tidak pernah jadi satu-satunya penanda (docs/06 §9 no.2).
 */
export function HeatmapGrid({ data }: { data: HeatmapResponse }) {
  const scale = heatmapScale(data.rows);

  return (
    <Table caption="Peta panas return sektor per periode (1 hari, 1 minggu, 1 bulan, 3 bulan)">
      <thead>
        <tr>
          <Th>Sektor</Th>
          {data.columns.map((column) => (
            <Th key={column} align="right">
              {heatmapColumnLabel(column)}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.code} data-testid={`heatmap-row-${row.code}`}>
            <Td>{row.name_id}</Td>
            {data.columns.map((column) => {
              const value = row.values[column] ?? null;
              const token = heatmapToken(value);
              return (
                <Td key={column} align="right">
                  <span
                    data-testid={`heatmap-cell-${row.code}-${column}`}
                    className="relative flex h-7 items-center justify-end rounded-sm px-2 font-mono tabular-nums"
                  >
                    {token && (
                      <span
                        aria-hidden="true"
                        data-testid={`heatmap-bg-${row.code}-${column}`}
                        className="absolute inset-0 rounded-sm"
                        style={{ backgroundColor: token, opacity: heatmapAlpha(value, scale) }}
                      />
                    )}
                    <span className="relative">{formatPct(value)}</span>
                  </span>
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
