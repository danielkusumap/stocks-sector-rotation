import { useRef, useState } from "react";
import type { StockSeriesResponse } from "../../lib/api";
import {
  bandWidth,
  chartAriaLabel,
  eventToken,
  hoverSummary,
  indexAtX,
  layoutCandles,
  levelLabel,
  needsBorder,
  overlayVisibility,
  priceDomain,
  scaleY,
  volumeHeight,
  xOfIndex,
} from "../../lib/candleChart";
import { formatNum, formatRp } from "../../lib/format";
import { REGIME_LABEL, TOOL_LABEL, regimeTone } from "../../lib/weeklyPicks";
import { EmptyState } from "../ui/EmptyState";
import { Pill } from "../ui/Pill";

/**
 * `CandleChart` (docs/06 §6.5, docs/08 F19) — SVG sendiri, tanpa library chart.
 * Semua angka (harga, MA, Donchian, kanal, level plan, penanda event, volume) datang
 * dari `GET /series/stock/{ticker}`; komponen ini hanya menggambar & memberi label.
 * Overlay yang tampil mengikuti rezim (`overlayVisibility`) — kanal S/R hanya di range/tipis.
 */

const VB_W = 780;
const PAD_LEFT = 32;
const PAD_RIGHT = 56;
const MAIN_H = Math.round(VB_W * 0.45); // rasio 1:0,45 (docs/06 §6.5)
const GAP = 10;
const VOL_H = Math.round(MAIN_H * 0.18);
const VB_H = MAIN_H + GAP + VOL_H + 18;

const PLOT = { width: VB_W - PAD_LEFT - PAD_RIGHT, height: MAIN_H };
const VOL_PLOT = { width: PLOT.width, height: VOL_H };

export function CandleChart({ data }: { data: StockSeriesResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const [pickedEvent, setPickedEvent] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (data.candles.length === 0) {
    return (
      <EmptyState
        title="belum ada bar harga untuk saham ini"
        hint="Jalankan langkah 2 (Ambil harga harian) di halaman Data, lalu buka lagi halaman ini."
      />
    );
  }

  const candles = data.candles;
  const count = candles.length;
  const overlays = data.overlays;
  const levels = data.levels;
  const visibility = overlayVisibility(data.regime);

  const maValues = Object.values(overlays.ma).flatMap((points) => points.map((p) => p.value));
  const channelValues = visibility.channel ? overlays.channels.flatMap((c) => [c.low, c.high]) : [];
  const levelValues = levels
    ? [levels.entry_zone.low, levels.entry_zone.high, levels.stop, levels.tp1, levels.tp2]
    : [];
  const domain = priceDomain(candles, [
    ...maValues,
    ...overlays.donchian.fast.high.map((p) => p.value),
    ...overlays.donchian.fast.low.map((p) => p.value),
    ...overlays.donchian.slow.high.map((p) => p.value),
    ...overlays.donchian.slow.low.map((p) => p.value),
    ...channelValues,
    ...levelValues,
  ]);

  const layout = layoutCandles(candles, domain, PLOT);
  const band = bandWidth(PLOT, count);
  const bodyWidth = Math.max(1, Math.min(9, band * 0.62));
  const maxVolume = Math.max(...candles.map((c) => c.volume), 1);
  const dateIndex = new Map(candles.map((candle, index) => [candle.date, index]));
  const xOfDate = (date: string | null | undefined): number | null => {
    if (!date) return null;
    const index = dateIndex.get(date);
    return index === undefined ? null : xOfIndex(index, count, PLOT) + PAD_LEFT;
  };
  const line = (points: { date: string; value: number }[]) =>
    points
      .map((point) => {
        const x = xOfDate(point.date);
        // harga & volume satu sumbu x: volume memakai skala sub-panel sendiri
        return x === null ? null : `${x},${scaleY(point.value, domain, PLOT)}`;
      })
      .filter((pair): pair is string => pair !== null)
      .join(" ");

  const hovered = hover === null ? null : candles[hover];
  // Kotak angka tidak menutupi 20 bar terakhir (docs/06 §6.3): hover di area itu → kotak ke kiri
  const boxLeft = hover === null ? 0 : hover >= count - 20;
  const hoverX = hover === null ? 0 : xOfIndex(hover, count, PLOT) + PAD_LEFT;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * VB_W;
    setHover(indexAtX(viewX - PAD_LEFT, count, PLOT));
  };

  const priceTicks = [domain.max, (domain.max + domain.min) / 2, domain.min];

  return (
    <div className="flex flex-col gap-2" data-testid="candle-chart">
      {/* legenda rezim + alat aktif: menjelaskan kenapa overlay-nya begini (docs/06 §6.5) */}
      <div className="flex flex-wrap items-center gap-2 px-3 text-sm" data-testid="candle-legend">
        <Pill tone={regimeTone(data.regime) === "down" ? "failed" : regimeTone(data.regime) === "warn" ? "partial" : "ok"} label={REGIME_LABEL[data.regime] ?? data.regime} />
        <span className="text-fg-muted">{data.active_tools.map((tool) => TOOL_LABEL[tool] ?? tool).join(" · ")}</span>
        <span className="text-fg-faint">{data.regime_reason}</span>
      </div>

      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        role="img"
        aria-label={chartAriaLabel({ ticker: data.ticker, regime: data.regime, bars: count, hasLevels: levels !== null })}
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* grid + label harga (padding kiri 32 px) */}
        {priceTicks.map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={VB_W - PAD_RIGHT} y1={scaleY(value, domain, PLOT)} y2={scaleY(value, domain, PLOT)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD_LEFT - 4} y={scaleY(value, domain, PLOT) + 3} textAnchor="end" fontSize={10} fill="var(--fg-faint)" className="font-mono">
              {formatRp(value)}
            </text>
          </g>
        ))}

        {/* kanal S/R — hanya rezim range/tipis (docs/03 §6.4.9) */}
        {visibility.channel &&
          overlays.channels.map((channel) => (
            <g key={`${channel.kind}-${channel.low}`} data-overlay="channel">
              <rect
                x={PAD_LEFT}
                y={scaleY(channel.high, domain, PLOT)}
                width={PLOT.width}
                height={Math.max(1, scaleY(channel.low, domain, PLOT) - scaleY(channel.high, domain, PLOT))}
                fill="var(--border)"
                opacity={0.1}
              />
              <line x1={PAD_LEFT} x2={VB_W - PAD_RIGHT} y1={scaleY((channel.low + channel.high) / 2, domain, PLOT)} y2={scaleY((channel.low + channel.high) / 2, domain, PLOT)} stroke="var(--border-strong)" strokeWidth={1} />
              <text x={VB_W - PAD_RIGHT + 4} y={scaleY((channel.low + channel.high) / 2, domain, PLOT) + 3} fontSize={10} fill="var(--fg-faint)">
                {channel.kind === "support" ? "penyangga" : "penahan"} ×{channel.strength}
              </text>
            </g>
          ))}

        {/* Donchian 20 (level breakout) & 40 (target terukur) */}
        <g data-overlay="donchian">
          <polyline points={line(overlays.donchian.fast.high)} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 3" />
          <polyline points={line(overlays.donchian.fast.low)} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 3" />
          <polyline points={line(overlays.donchian.slow.high)} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 3" opacity={0.5} />
          <polyline points={line(overlays.donchian.slow.low)} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 3" opacity={0.5} />
        </g>

        {/* MA20 solid, MA50 putus-putus */}
        <g data-overlay="ma">
          {Object.entries(overlays.ma).map(([period, points], index) => (
            <polyline
              key={period}
              points={line(points)}
              fill="none"
              stroke={index === 0 ? "var(--fg-muted)" : "var(--fg-faint)"}
              strokeWidth={1.5}
              strokeDasharray={index === 0 ? undefined : "4 3"}
            />
          ))}
        </g>

        {/* zona entry + SL/TP (hanya bila plan ada) */}
        {levels && (
          <g data-overlay="levels">
            <rect
              x={PAD_LEFT}
              y={scaleY(levels.entry_zone.high, domain, PLOT)}
              width={PLOT.width}
              height={Math.max(1, scaleY(levels.entry_zone.low, domain, PLOT) - scaleY(levels.entry_zone.high, domain, PLOT))}
              fill="var(--accent-subtle)"
              opacity={0.25}
            />
            {(
              [
                ["SL", levels.stop, "var(--down)"],
                ["TP1", levels.tp1, "var(--up)"],
                ["TP2", levels.tp2, "var(--up)"],
              ] as const
            ).map(([name, value, color]) => (
              <g key={name} data-level={name}>
                <line x1={PAD_LEFT} x2={VB_W - PAD_RIGHT} y1={scaleY(value, domain, PLOT)} y2={scaleY(value, domain, PLOT)} stroke={color} strokeWidth={1} strokeDasharray="4 3" />
                <text x={VB_W - PAD_RIGHT + 4} y={scaleY(value, domain, PLOT) + 3} fontSize={10} fill={color} className="font-mono">
                  {levelLabel(name, value)}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* candle: body max(1px), wick 1 px, border --surface saat body tipis */}
        <g data-overlay="candles">
          {layout.map((bar) => {
            const candle = candles[bar.index];
            return (
              <g key={candle.date} data-candle={bar.up ? "up" : "down"}>
                <line x1={bar.x + PAD_LEFT} x2={bar.x + PAD_LEFT} y1={bar.wickTop} y2={bar.wickBottom} stroke={bar.up ? "var(--up)" : "var(--down)"} strokeWidth={1} />
                <rect
                  x={bar.x + PAD_LEFT - bodyWidth / 2}
                  y={bar.bodyY}
                  width={bodyWidth}
                  height={bar.bodyHeight}
                  fill={bar.up ? "var(--up)" : "var(--down)"}
                  stroke={needsBorder(bar.bodyHeight) ? "var(--surface)" : undefined}
                  strokeWidth={needsBorder(bar.bodyHeight) ? 1 : 0}
                />
              </g>
            );
          })}
        </g>

        {/* penanda event breakout: segitiga di bawah bar sinyal */}
        <g data-overlay="events">
          {data.events.map((event, index) => {
            const x = xOfDate(event.signal_date);
            if (x === null) return null;
            const y = VB_H - 16;
            return (
              <g key={`${event.signal_date}-${index}`}>
                <polygon
                  data-event-result={event.result}
                  points={`${x},${y - 6} ${x - 5},${y + 2} ${x + 5},${y + 2}`}
                  fill={`var(${eventToken(event.result)})`}
                  onClick={() => setPickedEvent(pickedEvent === index ? null : index)}
                  className="cursor-pointer"
                />
              </g>
            );
          })}
        </g>

        {/* sub-panel volume + rata-rata 20 bar + ambang konfirmasi */}
        <g data-overlay="volume">
          {candles.map((candle, index) => (
            <rect
              key={candle.date}
              x={xOfIndex(index, count, PLOT) + PAD_LEFT - bodyWidth / 2}
              y={MAIN_H + GAP + VOL_H - volumeHeight(candle.volume, maxVolume, VOL_PLOT.height)}
              width={bodyWidth}
              height={volumeHeight(candle.volume, maxVolume, VOL_PLOT.height)}
              fill={candle.close >= candle.open ? "var(--up)" : "var(--down)"}
              opacity={0.5}
            />
          ))}
          <polyline
            points={overlays.volume_ma
              .map((point) => {
                const x = xOfDate(point.date);
                return x === null ? null : `${x},${MAIN_H + GAP + VOL_H - volumeHeight(point.value, maxVolume, VOL_PLOT.height)}`;
              })
              .filter((pair): pair is string => pair !== null)
              .join(" ")}
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth={1}
          />
          <line
            x1={PAD_LEFT}
            x2={VB_W - PAD_RIGHT}
            y1={MAIN_H + GAP + VOL_H - volumeHeight(maxVolume * 0.75, maxVolume, VOL_PLOT.height)}
            y2={MAIN_H + GAP + VOL_H - volumeHeight(maxVolume * 0.75, maxVolume, VOL_PLOT.height)}
            stroke="var(--warn)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text x={PAD_LEFT - 4} y={MAIN_H + GAP + 10} textAnchor="end" fontSize={10} fill="var(--fg-faint)">
            Vol
          </text>
        </g>

        {/* garis bidik hover */}
        {hover !== null && (
          <line x1={hoverX} x2={hoverX} y1={0} y2={MAIN_H} stroke="var(--focus)" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>

      {hovered && (
        <div
          data-testid="candle-hover"
          className="pointer-events-none absolute z-10 max-w-72 rounded-sm border border-border bg-surface px-2 py-1 text-sm text-fg shadow-float"
          style={{
            left: `${(hoverX / VB_W) * 100}%`,
            // docs/06 §6.3: kotak tidak menutupi 20 bar terakhir → geser ke kiri garis bidik
            transform: boxLeft ? "translateX(-105%)" : "translateX(4px)",
          }}
        >
          <p className="font-mono">{hoverSummary(hovered)}</p>
          <p className="text-fg-muted">{hovered.date}</p>
        </div>
      )}

      </div>

      {/* klik penanda event → baris hasil (docs/06 §6.5) */}
      {pickedEvent !== null && data.events[pickedEvent] && (
        <p className="px-3 text-sm" data-testid="candle-event-line">
          breakout {data.events[pickedEvent].signal_date} · {eventResultText(data.events[pickedEvent])}
        </p>
      )}

      <p className="px-3 text-sm text-fg-faint">
        harga penyesuaian · {formatNum(count, 0)} bar terakhir
      </p>
    </div>
  );
}

/** Baris hasil event: `+5% dulu dalam 7 bar` / `−5% dulu dalam 4 bar` / `belum selesai` / `lewat batas`. */
function eventResultText(event: StockSeriesResponse["events"][number]): string {
  if (event.result === "open") return "belum selesai";
  if (event.result === "expired") return "lewat batas waktu";
  const pct = event.result === "win" ? "+5%" : "−5%";
  const periods = event.periods === null ? "" : ` dalam ${formatNum(event.periods, 0)} bar`;
  return `${pct} dulu${periods}`;
}

