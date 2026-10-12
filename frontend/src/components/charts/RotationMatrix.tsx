import type { RotationMatrixResponse } from "../../lib/api";
import { cn } from "../../lib/cn";
import { QUADRANT_LABEL } from "../../lib/quadrant";
import { QUADRANT_OPTIONS } from "../../lib/filters";
import { Table, Td, Th } from "../ui/Table";

/**
 * `RotationMatrix` (docs/06 §5): matriks 4×4 jumlah transisi kuadran + daftar perubahan.
 * Kuadran di sini hanya label & jumlah — tidak ada perhitungan di frontend (docs/05 §5.3).
 */
export function RotationMatrix({ data }: { data: RotationMatrixResponse }) {
  const counts = new Map(data.cells.map((cell) => [`${cell.from}|${cell.to}`, cell]));

  return (
    <div className="flex flex-col gap-3 p-3">
      <Table caption={`Matriks transisi kuadran ${data.from} → ${data.to}`}>
        <thead>
          <tr>
            <Th>dari \ ke</Th>
            {QUADRANT_OPTIONS.map((quadrant) => (
              <Th key={quadrant} align="right">
                {QUADRANT_LABEL[quadrant]}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUADRANT_OPTIONS.map((from) => (
            <tr key={from}>
              <Td>{QUADRANT_LABEL[from]}</Td>
              {QUADRANT_OPTIONS.map((to) => {
                const cell = counts.get(`${from}|${to}`);
                return (
                  <Td key={to} align="right">
                    <span
                      data-testid={`matrix-cell-${from}-${to}`}
                      data-count={cell?.count ?? 0}
                      title={cell ? cell.refs.join(", ") : undefined}
                      className={cn(
                        "font-mono tabular-nums",
                        !cell && "text-fg-faint",
                        from === to && cell && "text-fg-muted",
                      )}
                    >
                      {cell ? cell.count : "·"}
                    </span>
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>

      <div>
        <p className="text-xs font-medium tracking-[0.04em] text-fg-muted uppercase">
          Perubahan kuadran ({data.changes.length})
        </p>
        {data.changes.length === 0 ? (
          <p className="mt-1 text-sm text-fg-faint">Tidak ada sektor yang pindah kuadran.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {data.changes.map((change) => (
              <li
                key={change.ref_id}
                data-testid={`matrix-change-${change.ref_id}`}
                className="flex items-baseline gap-2 text-sm"
              >
                <span className="font-medium">{change.name}</span>
                <span className="text-fg-muted">
                  {QUADRANT_LABEL[change.from]} → {QUADRANT_LABEL[change.to]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
