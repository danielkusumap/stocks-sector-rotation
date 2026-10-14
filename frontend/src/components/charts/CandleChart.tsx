import { useEffect, useRef, useState } from "react";
import type { StockSeriesResponse } from "../../lib/api";
import {
  bandWidth,
  chartAriaLabel,
  deepZoom,
  eventToken,
  hoverSummary,
  indexAtX,
  layoutCandles,
  levelLabel,
  needsBorder,
  overlayVisibility,
  panBy,
  pocLabel,
  elliottShapes,
  layerNotice,
  smcShapes,
  priceDomain,
  scaleY,
  shiftDomain,
  ursiGuides,
  ursiRangeNote,
  ursiTitle,
  ursiY,
  visibleLabel,
  visibleRange,
  vwapAnchorLabel,
  vwapWarning,
  volumeHeight,
  xOfIndex,
  zoomAt,
  type ViewRange,
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
/** Sub-panel Ultimate RSI 18% tinggi (docs/06 §6.6), hanya ada saat lapisan `indicators` aktif. */
const URSI_H = Math.round(MAIN_H * 0.18);

const PLOT = { width: VB_W - PAD_LEFT - PAD_RIGHT, height: MAIN_H };
const VOL_PLOT = { width: PLOT.width, height: VOL_H };

export function CandleChart({ data }: { data: StockSeriesResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const [pickedEvent, setPickedEvent] = useState<number | null>(null);
  // zoom & pan (F23): rentang bar terlihat + geseran sumbu harga (fraksi domain)
  const [view, setView] = useState<ViewRange | null>(null);
  const [shift, setShift] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; start: number; shift: number } | null>(null);

  if (data.candles.length === 0) {
    return (
      <EmptyState
        title="belum ada bar harga untuk saham ini"
        hint="Jalankan langkah 2 (Ambil harga harian) di halaman Data, lalu buka lagi halaman ini."
      />
    );
  }

  const candles = data.candles;
  // lapisan indikator (F21): hanya dipakai bila backend mengirimnya & ada titiknya
  const indicators = data.indicators;
  const ursi = indicators?.ursi && indicators.ursi.points.length > 0 ? indicators.ursi : null;
  const vwap = indicators?.vwap && indicators.vwap.points.length > 0 ? indicators.vwap : null;
  const poc = indicators?.poc ?? null;
  const volTop = MAIN_H + GAP;
  // URSI disembunyikan di rezim range (docs/06 §6.6) → diganti catatan di legenda
  const showUrsI = ursi !== null && data.regime !== "range";
  const ursiTop = volTop + VOL_H + GAP;
  const VB_H = (showUrsI ? ursiTop + URSI_H : volTop + VOL_H) + 18;
  const total = candles.length;
  const span = visibleRange(view, total);
  // zoom/pan (F23): hanya bar di rentang terlihat yang digambar — skala ikut rentang itu
  const bars = span.start === 0 && span.end === total ? candles : candles.slice(span.start, span.end);
  const count = bars.length;
  const dateIndex = new Map(bars.map((candle, index) => [candle.date, index]));
  const overlays = data.overlays;
  const levels = data.levels;
  const visibility = overlayVisibility(data.regime);
  // titik overlay di luar rentang dibuang supaya domain tidak melebar (docs/06 §6.8)
  const inView = (points: { date: string; value: number }[]) => points.filter((point) => dateIndex.has(point.date));

  const maValues = Object.values(overlays.ma).flatMap((points) => inView(points).map((p) => p.value));
  const donchianValues = [
    overlays.donchian.fast.high,
    overlays.donchian.fast.low,
    overlays.donchian.slow.high,
    overlays.donchian.slow.low,
  ].flatMap((points) => inView(points).map((p) => p.value));
  const channelValues = visibility.channel ? overlays.channels.flatMap((c) => [c.low, c.high]) : [];
  const barsLow = Math.min(...bars.map((bar) => bar.low));
  const barsHigh = Math.max(...bars.map((bar) => bar.high));
  // garis level/VWAP/POC hanya digambar bila harganya ada di rentang terlihat (docs/06 §6.8b)
  const inRange = (value: number) => value >= barsLow && value <= barsHigh;
  const levelValues = levels
    ? [levels.entry_zone.low, levels.entry_zone.high, levels.stop, levels.tp1, levels.tp2].filter(inRange)
    : [];
  const domain = shiftDomain(priceDomain(bars, [...maValues, ...donchianValues, ...channelValues, ...levelValues]), shift);

  const layout = layoutCandles(bars, domain, PLOT);
  const band = bandWidth(PLOT, count);
  const bodyWidth = Math.max(1, Math.min(9, band * 0.62));
  const maxVolume = Math.max(...bars.map((c) => c.volume), 1);
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

  // lapisan konteks SMC/Elliott (F22): digambar **hanya** bila toggle di URL diminta (backend
  // menggemakan `layers`); respons yang memuat lapisannya saja tidak cukup untuk menampilkannya
  const shapeScale = { x: xOfDate, y: (price: number) => scaleY(price, domain, PLOT), left: PAD_LEFT, right: VB_W - PAD_RIGHT };
  const smcFigure = data.layers.includes("smc") && data.smc ? smcShapes(data.smc, shapeScale) : [];
  const elliottFigure = data.layers.includes("elliott") && data.elliott ? elliottShapes(data.elliott, shapeScale) : [];

  const hovered = hover === null ? null : bars[hover];
  // Kotak angka tidak menutupi 20 bar terakhir (docs/06 §6.3): hover di area itu → kotak ke kiri
  const boxLeft = hover === null ? 0 : hover >= count - 20;
  const hoverX = hover === null ? 0 : xOfIndex(hover, count, PLOT) + PAD_LEFT;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current) return; // saat men-drag, hover tidak dihitung ulang
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * VB_W;
    setHover(indexAtX(viewX - PAD_LEFT, count, PLOT));
  };

  /** Indeks bar di bawah posisi x layar — dipakai roda mouse sebagai titik jangkar zoom. */
  const indexAtClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return span.start + Math.floor(count / 2);
    const viewX = ((clientX - rect.left) / rect.width) * VB_W;
    return (indexAtX(viewX - PAD_LEFT, count, PLOT) ?? Math.floor(count / 2)) + span.start;
  };

  const zoomBy = (factor: number, anchorIndex: number) => setView(zoomAt(view, total, factor, anchorIndex));
  const resetView = () => {
    setView(null);
    setShift(0);
    setHover(null);
  };

  // roda mouse: zoom di posisi kursor (docs/06 §6.8). Listener native non-passive — React
  // mendaftarkan `onWheel` sebagai passive, sehingga `preventDefault()` tidak menghentikan
  // scroll halaman (grafik ikut tergeser) dan memicu warning konsol.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 1.25 : 0.8, indexAtClientX(event.clientX));
    };
    svg.addEventListener("wheel", onWheelNative, { passive: false });
    return () => svg.removeEventListener("wheel", onWheelNative);
  });

  // keyboard: `+` / `-` / `0` (reset) + pan dengan panah (geser = 20 bar)
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const step = event.shiftKey ? 20 : 5;
    const middle = span.start + Math.floor(count / 2);
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(0.8, middle);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(1.25, middle);
    } else if (event.key === "0") {
      event.preventDefault();
      resetView();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setView(panBy(view, total, -step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setView(panBy(view, total, step));
    }
  };

  // drag horizontal = pan; vertikal aktif saat zoom dalam (docs/06 §6.8)
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, start: span.start, shift };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const barsPerPx = count / Math.max(1, rect.width * (PLOT.width / VB_W));
    const deltaBars = Math.round((drag.x - event.clientX) * barsPerPx);
    const next = panBy({ start: drag.start, end: drag.start + count }, total, deltaBars);
    const deltaFraction = deepZoom(next, total) ? (event.clientY - drag.y) / (PLOT.height * 0.1) : 0;
    setView(next);
    setShift(Math.max(-1, Math.min(1, drag.shift + deltaFraction)));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const priceTicks = [domain.max, (domain.max + domain.min) / 2, domain.min];

  return (
    <div className="flex flex-col gap-2" data-testid="candle-chart">
      {/* legenda rezim + alat aktif: menjelaskan kenapa overlay-nya begini (docs/06 §6.5) */}
      <div className="flex flex-wrap items-center gap-2 px-3 text-sm" data-testid="candle-legend">
        <Pill tone={regimeTone(data.regime) === "down" ? "failed" : regimeTone(data.regime) === "warn" ? "partial" : "ok"} label={REGIME_LABEL[data.regime] ?? data.regime} />
        <span className="text-fg-muted">{data.active_tools.map((tool) => TOOL_LABEL[tool] ?? tool).join(" · ")}</span>
        <span className="text-fg-faint">{data.regime_reason}</span>
        {/* VWAP/VWAP-anchor/POC: label jujur wajib (docs/06 §6.6) */}
        {vwap && (
          <>
            <span className="font-mono text-fg-muted" data-testid="vwap-anchor">
              {vwapAnchorLabel(vwap.len, vwap.anchor_date)}
            </span>
            {vwapWarning(data.regime) && (
              <span className="text-warn" data-testid="vwap-warning">
                {vwapWarning(data.regime)}
              </span>
            )}
          </>
        )}
        {poc && (
          <span className="text-warn" data-testid="poc-label">
            POC {pocLabel(poc.basis, poc.bars_used)}
          </span>
        )}
        {ursiRangeNote(data.regime) && (
          <span className="text-fg-faint" data-testid="ursi-range-note">
            {ursiRangeNote(data.regime)}
          </span>
        )}
        {/* SMC/Elliott = lapisan konteks: wajib disebut, plus catatan API apa adanya (docs/06 §6.7) */}
        {(["smc", "elliott"] as const).map((layer) =>
          data.layers.includes(layer) ? (
            <span key={layer} className="text-fg-faint" data-testid={`layer-notice-${layer}`}>
              {layerNotice(layer)}
            </span>
          ) : null,
        )}
        {elliottFigure.length > 0 && data.elliott?.invalidated && (
          <span className="text-warn" data-testid="elliott-invalidated">
            pola batal
          </span>
        )}
        {elliottFigure.length > 0 && data.elliott?.note && (
          <span className="text-warn" data-testid="elliott-note">
            {data.elliott.note}
          </span>
        )}
        {/* zoom & pan (F23): `Reset`/klik ganda/`0`; rentang terlihat diumumkan aria-live */}
        {view !== null && (
          <button
            type="button"
            data-testid="candle-reset"
            onClick={resetView}
            className="inline-flex h-7 items-center rounded-sm border border-border px-2.5 text-fg-muted hover:text-fg"
          >
            Reset
          </button>
        )}
        <span
          aria-live="polite"
          data-testid="candle-live"
          className={view === null ? "sr-only" : "ml-auto font-mono text-fg-muted"}
        >
          {visibleLabel(bars.map((bar) => bar.date))}
        </span>
      </div>

      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        role="img"
        aria-label={chartAriaLabel({ ticker: data.ticker, regime: data.regime, bars: count, hasLevels: levels !== null })}
        className="block cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-focus"
        tabIndex={0}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
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

        {/* VWAP + pita ±1σ/±2σ (lapisan `indicators`) — garis & pita dari API */}
        {vwap && (
          <g data-overlay="vwap" pointerEvents="none">
            {vwap.points.map((point) => {
              const x = xOfDate(point.date);
              if (x === null) return null;
              const band = (a: number, b: number, opacity: number, dashed: boolean) => (
                <line
                  key={`${point.date}-${a}-${b}`}
                  x1={x}
                  x2={x}
                  y1={scaleY(a, domain, PLOT)}
                  y2={scaleY(b, domain, PLOT)}
                  stroke="var(--accent)"
                  strokeWidth={dashed ? 1 : 8}
                  strokeDasharray={dashed ? "3 3" : undefined}
                  opacity={dashed ? 0.35 : opacity}
                />
              );
              return (
                <g key={point.date}>
                  {band(point.upper1, point.lower1, 0.1, false)}
                  {band(point.upper2, point.upper2 + 0.0001, 0.35, true)}
                  {band(point.lower2, point.lower2 - 0.0001, 0.35, true)}
                  <line x1={x} x2={x} y1={scaleY(point.upper2, domain, PLOT)} y2={scaleY(point.upper2, domain, PLOT)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.35} />
                  <line x1={x} x2={x} y1={scaleY(point.lower2, domain, PLOT)} y2={scaleY(point.lower2, domain, PLOT)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.35} />
                  <line x1={x} x2={x} y1={scaleY(point.vwap, domain, PLOT)} y2={scaleY(point.vwap, domain, PLOT)} stroke="var(--accent)" strokeWidth={1.5} />
                </g>
              );
            })}
          </g>
        )}

        {/* POC + value area (lapisan `indicators`): label basis ada di legenda; gambar hanya bila di rentang */}
        {poc && inRange(poc.poc) && (
          <g data-overlay="poc" pointerEvents="none">
            <rect
              x={PAD_LEFT}
              y={scaleY(poc.value_area.high, domain, PLOT)}
              width={PLOT.width}
              height={Math.max(1, scaleY(poc.value_area.low, domain, PLOT) - scaleY(poc.value_area.high, domain, PLOT))}
              fill="var(--warn)"
              opacity={0.06}
            />
            <line x1={PAD_LEFT} x2={VB_W - PAD_RIGHT} y1={scaleY(poc.poc, domain, PLOT)} y2={scaleY(poc.poc, domain, PLOT)} stroke="var(--warn)" strokeWidth={1} />
          </g>
        )}

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

        {/* zona entry + SL/TP (hanya bila plan ada) — hanya yang di rentang terlihat */}
        {levels && (levelValues.length > 0 || inRange(levels.entry_zone.low) || inRange(levels.entry_zone.high)) && (
          <g data-overlay="levels">
            {(inRange(levels.entry_zone.low) || inRange(levels.entry_zone.high)) && (
              <rect
              x={PAD_LEFT}
              y={scaleY(levels.entry_zone.high, domain, PLOT)}
              width={PLOT.width}
              height={Math.max(1, scaleY(levels.entry_zone.low, domain, PLOT) - scaleY(levels.entry_zone.high, domain, PLOT))}
              fill="var(--accent-subtle)"
              opacity={0.25}
              />
            )}
            {(
              [
                ["SL", levels.stop, "var(--down)"],
                ["TP1", levels.tp1, "var(--up)"],
                ["TP2", levels.tp2, "var(--up)"],
              ] as const
            )
              .filter(([, value]) => inRange(value))
              .map(([name, value, color]) => (
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
            const candle = bars[bar.index];
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
          {bars.map((candle, index) => (
            <rect
              key={candle.date}
              x={xOfIndex(index, count, PLOT) + PAD_LEFT - bodyWidth / 2}
              y={volTop + VOL_H - volumeHeight(candle.volume, maxVolume, VOL_PLOT.height)}
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
                return x === null ? null : `${x},${volTop + VOL_H - volumeHeight(point.value, maxVolume, VOL_PLOT.height)}`;
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
            y1={volTop + VOL_H - volumeHeight(maxVolume * 0.75, maxVolume, VOL_PLOT.height)}
            y2={volTop + VOL_H - volumeHeight(maxVolume * 0.75, maxVolume, VOL_PLOT.height)}
            stroke="var(--warn)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text x={PAD_LEFT - 4} y={volTop + 10} textAnchor="end" fontSize={10} fill="var(--fg-faint)">
            Vol
          </text>
        </g>

        {/* sub-panel Ultimate RSI (docs/06 §6.6): skala tetap 0–100, garis 50 + ambang ob/os */}
        {showUrsI && ursi && (
          <g data-overlay="ursi" pointerEvents="none">
            <rect x={PAD_LEFT} y={ursiY(100, URSI_H)} width={PLOT.width} height={Math.max(1, ursiY(ursi.ob, URSI_H))} fill="var(--up)" opacity={0.08} transform={`translate(0, ${ursiTop})`} />
            <rect x={PAD_LEFT} y={ursiY(ursi.os, URSI_H)} width={PLOT.width} height={Math.max(1, URSI_H - ursiY(ursi.os, URSI_H))} fill="var(--down)" opacity={0.08} transform={`translate(0, ${ursiTop})`} />
            {[ursiGuides(ursi.ob, ursi.os, URSI_H).y50, ursiGuides(ursi.ob, ursi.os, URSI_H).yOb, ursiGuides(ursi.ob, ursi.os, URSI_H).yOs].map((y, index) => (
              <line
                key={index}
                x1={PAD_LEFT}
                x2={VB_W - PAD_RIGHT}
                y1={ursiTop + y}
                y2={ursiTop + y}
                stroke={index === 0 ? "var(--border)" : "var(--border-strong)"}
                strokeWidth={1}
                strokeDasharray={index === 0 ? undefined : "3 3"}
              />
            ))}
            <polyline
              points={ursi.points
                .map((point) => {
                  const x = xOfDate(point.date);
                  return x === null ? null : `${x},${ursiTop + ursiY(point.value, URSI_H)}`;
                })
                .filter((pair): pair is string => pair !== null)
                .join(" ")}
              fill="none"
              stroke="var(--fg)"
              strokeWidth={1.5}
            />
            <polyline
              points={ursi.points
                .map((point) => {
                  const x = xOfDate(point.date);
                  return x === null ? null : `${x},${ursiTop + ursiY(point.signal, URSI_H)}`;
                })
                .filter((pair): pair is string => pair !== null)
                .join(" ")}
              fill="none"
              stroke="var(--fg-faint)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text x={PAD_LEFT - 4} y={ursiTop + 10} textAnchor="end" fontSize={10} fill="var(--fg-faint)">
              {ursiTitle(ursi.len, ursi.method)}
            </text>
          </g>
        )}

        {/* lapisan konteks SMC (F22): pointer-events none supaya hover bar tetap jalan */}
        {smcFigure.length > 0 && (
          <g data-layer="smc" pointerEvents="none">
            {smcFigure.map((shape, index) =>
              shape.kind === "box" ? (
                <g key={`${shape.kind}-${index}`}>
                  <rect
                    x={shape.x1}
                    y={shape.y1}
                    width={Math.max(0, shape.x2 - shape.x1)}
                    height={Math.max(1, shape.y2 - shape.y1)}
                    fill={shape.tone === "up" ? "var(--up)" : shape.tone === "down" ? "var(--down)" : "var(--border)"}
                    fillOpacity={shape.style.opacity}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                    strokeOpacity={shape.style.dashed ? 0.4 : 1}
                    strokeDasharray={shape.style.dashed ? (shape.style.dash ?? "3 3") : undefined}
                  />
                  {shape.label && (
                    <text x={shape.x1 + 3} y={shape.y1 - 2} fontSize={9} fill="var(--fg-faint)">
                      {shape.label}
                    </text>
                  )}
                </g>
              ) : (
                <g key={`${shape.kind}-${index}`}>
                  <line
                    x1={shape.x1}
                    x2={shape.x2}
                    y1={shape.y1}
                    y2={shape.y2}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                    strokeDasharray={shape.style.dashed ? (shape.style.dash ?? "3 3") : undefined}
                    opacity={shape.style.opacity}
                  />
                  {shape.label && (
                    <text x={shape.x2 - 2} y={shape.y1 - 3} textAnchor="end" fontSize={9} fill="var(--fg-faint)">
                      {shape.label}
                    </text>
                  )}
                </g>
              ),
            )}
          </g>
        )}

        {/* lapisan konteks Elliott (F22): ZigZag + label wave + zona Fib */}
        {elliottFigure.length > 0 && (
          <g data-layer="elliott" pointerEvents="none">
            {elliottFigure.map((shape, index) =>
              shape.kind === "zigzag" ? (
                <polyline
                  key={`zigzag-${index}`}
                  points={(shape.points ?? []).map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="var(--fg-faint)"
                  strokeWidth={1}
                  opacity={shape.style.opacity}
                  strokeDasharray={shape.style.dashed ? "4 3" : undefined}
                />
              ) : shape.kind === "label" ? (
                <text
                  key={`label-${index}`}
                  x={shape.x}
                  y={shape.y}
                  dx={3}
                  dy={-3}
                  fontSize={10}
                  fill="var(--fg-muted)"
                  opacity={shape.style.opacity}
                >
                  {shape.label}
                </text>
              ) : (
                <g key={`fib-${index}`}>
                  <line
                    x1={PAD_LEFT}
                    x2={shape.x}
                    y1={shape.y}
                    y2={shape.y}
                    stroke="var(--fg-faint)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={shape.style.opacity}
                  />
                  <text x={shape.x} y={(shape.y ?? 0) - 2} textAnchor="end" fontSize={9} fill="var(--fg-faint)">
                    {shape.label}
                  </text>
                </g>
              ),
            )}
          </g>
        )}

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

