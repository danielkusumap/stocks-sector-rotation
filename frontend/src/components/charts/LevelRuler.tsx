import type { PlanPick } from "../../lib/api";
import { formatRp } from "../../lib/format";
import { rulerAriaLabel, rulerGeometry } from "../../lib/swingPicks";

/**
 * **Penggaris level** (docs/08 F25 butir 4): posisi `stop`, pita zona beli, `tp1`, `tp2`, dan harga
 * terakhir pada satu garis harga. Hanya **interpolasi geometri** dari angka API (`rulerGeometry`) —
 * tidak ada harga baru yang dihitung. Angka tetap dibaca dari label + `aria-label` (AC 8: status
 * tidak boleh ditandai warna saja).
 */
const W = 420;
const H = 96;
const PAD_X = 16;
const AXIS_Y = 52;

export function LevelRuler({ pick }: { pick: PlanPick }) {
  const { stops, zone, last } = rulerGeometry(pick);
  const x = (ratio: number) => PAD_X + ratio * (W - PAD_X * 2);
  const tone: Record<string, string> = {
    stop: "var(--down)",
    tp1: "var(--up)",
    tp2: "var(--up)",
    last: "var(--accent)",
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={rulerAriaLabel(pick)}
      data-testid={`level-ruler-${pick.ticker}`}
      className="block"
    >
      {/* garis harga */}
      <line x1={PAD_X} x2={W - PAD_X} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--border-strong)" strokeWidth={1} />

      {/* pita zona beli */}
      {zone && (
        <rect
          x={x(zone.from)}
          y={AXIS_Y - 10}
          width={Math.max(2, x(zone.to) - x(zone.from))}
          height={20}
          fill="var(--accent-subtle)"
          stroke="var(--accent)"
          strokeWidth={1}
        />
      )}

      {stops.map((stop) => (
        <g key={stop.kind} data-ruler={stop.kind}>
          <line x1={x(stop.ratio)} x2={x(stop.ratio)} y1={AXIS_Y - 22} y2={AXIS_Y + 22} stroke={tone[stop.kind]} strokeWidth={stop.kind === "last" ? 2 : 1} />
          {stop.kind === "last" && <circle cx={x(stop.ratio)} cy={AXIS_Y} r={4} fill="var(--accent)" />}
          <text
            x={x(stop.ratio)}
            y={AXIS_Y + 36}
            textAnchor={stop.ratio < 0.12 ? "start" : stop.ratio > 0.88 ? "end" : "middle"}
            fontSize={10}
            fill={tone[stop.kind]}
            className="font-mono"
          >
            {formatRp(stop.kind === "last" ? (last ?? pick.close) : stop.kind === "stop" ? pick.stop.level : stop.kind === "tp1" ? pick.tp1.level : pick.tp2.level)}
          </text>
        </g>
      ))}

      {/* keterangan kiri-bawah: arah harga (kiri = batas rugi, kanan = target) */}
      <text x={PAD_X} y={H - 6} fontSize={9} fill="var(--fg-faint)">
        kiri = batas rugi · kanan = target · kuning = harga terakhir (harga penyesuaian)
      </text>
    </svg>
  );
}
