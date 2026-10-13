import { scaleLinear } from "d3-scale";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link } from "react-router";
import type { Quadrant, RrgItem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { QUADRANT_BG } from "../../lib/quadrant";
import {
  AXIS_CENTER,
  CARD_GAP_PX,
  CARD_HEIGHT_PX,
  CARD_MARGIN_PX,
  CARD_WIDTH_PX,
  DIM_POINT_OPACITY,
  DIM_TAIL_OPACITY,
  FOCUS_RADIUS,
  FOCUS_RING_WIDTH,
  MIN_LABEL_DISTANCE_PX,
  POINT_RADIUS,
  axisPad,
  axisTicks,
  cappedItems,
  cardPlacement,
  describePoint,
  hasTail,
  labelledRefIds,
  legendEntries,
  legendNeedsSearch,
  orderedItems,
  pointLabel,
  stockLabel,
  tailSegmentOpacity,
  tickLabel,
  viewBoxDistanceForScreenPx,
} from "../../lib/rrgChart";
import { formatNum } from "../../lib/format";
import { QUADRANT_LABEL } from "../../lib/quadrant";
import { PointCard } from "../domain/PointCard";
import { QuadrantBadge } from "../ui/QuadrantBadge";
import { StreakBadge } from "../ui/StreakBadge";

const VIEW_W = 780;
const VIEW_H = 608; // rasio 1 : 0.78 (docs/06 §6)
const PAD = 32; // ruang label

export interface QuadrantChartProps {
  items: RrgItem[];
  scope?: "sector" | "stock";
  /** state pin bersama halaman/tabel: satu `selectedRefId` untuk chart + tabel (docs/06 §6.1). */
  selectedRefId: string | null;
  onSelect: (refId: string | null) => void;
  label?: string;
  /** tautan "lihat semua di tabel" saat titik dipotong (scope saham). */
  showAllHref?: string;
  /** buka detail (drawer) dari kartu hover — dipakai `PointCard` (docs/08 F7). */
  onOpenDetail?: (refId: string) => void;
  className?: string;
}

/**
 * Diagram RRG (docs/06 §6 + §6.1). Menggambar sendiri dengan `d3-scale` — tanpa library chart.
 * Mode fokus: titik aktif terang & r membesar (dirender paling atas), titik/ekor lain meredup,
 * sedangkan garis 100 dan zona kuadran tidak ikut meredup.
 */
export function QuadrantChart({
  items,
  scope = "sector",
  selectedRefId,
  onSelect,
  label = "Diagram RRG",
  showAllHref = "/stocks",
  onOpenDetail,
  className,
}: QuadrantChartProps) {
  const ordered = useMemo(() => orderedItems(items, scope), [items, scope]);
  const { items: shown, hiddenCount } = useMemo(() => cappedItems(ordered, scope), [ordered, scope]);

  const pad = useMemo(
    () =>
      axisPad(
        shown.flatMap((item) => [
          item.rs_ratio,
          item.rs_momentum,
          ...item.tail.flatMap((point) => [point.rs_ratio, point.rs_momentum]),
        ]),
      ),
    [shown],
  );
  const xScale = useMemo(
    () => scaleLinear().domain([AXIS_CENTER - pad, AXIS_CENTER + pad]).range([PAD, VIEW_W - PAD]),
    [pad],
  );
  const yScale = useMemo(
    () =>
      scaleLinear()
        .domain([AXIS_CENTER - pad, AXIS_CENTER + pad])
        .range([VIEW_H - PAD, PAD]),
    [pad],
  );

  const [hovered, setHovered] = useState<string | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const [chartFocused, setChartFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [labelDistance, setLabelDistance] = useState(MIN_LABEL_DISTANCE_PX);
  const [legendQuery, setLegendQuery] = useState("");
  /** skala px layar per satuan viewBox — dipakai mengubah px ↔ viewBox (docs/06 §6.3) */
  const [scale, setScale] = useState(0);
  const [cardSize, setCardSize] = useState({ w: CARD_WIDTH_PX, h: CARD_HEIGHT_PX });
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastExternal = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Ambang anti-tumpuk label diukur dalam pixel layar (docs/06 §6) → dikonversi ke satuan viewBox
  // dan dihitung ulang tiap lebar berubah, supaya chart sempit tidak menumpuk labelnya.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = () => {
      const renderedWidth = element.clientWidth;
      if (renderedWidth > 0) {
        setLabelDistance(viewBoxDistanceForScreenPx(MIN_LABEL_DISTANCE_PX, renderedWidth, VIEW_W));
        setScale(renderedWidth / VIEW_W);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Elemen fokus terakhir di luar chart — dipakai Esc untuk mengembalikan fokus (docs/06 §6.1).
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !rootRef.current?.contains(target)) lastExternal.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);

  // Hover menang atas pin (titik lain tetap bisa di-hover), pin menang atas fokus keyboard.
  const keyboardRefId = chartFocused && keyboardIndex !== null ? shown[keyboardIndex]?.ref_id : null;
  const activeRefId = hovered ?? selectedRefId ?? keyboardRefId ?? null;
  const dimmed = activeRefId !== null;
  const activeItem = shown.find((item) => item.ref_id === activeRefId) ?? null;

  // Ukuran kartu diukur dari DOM (lebar `w-60`, tinggi tergantung isi) sebelum digambar,
  // supaya posisinya bisa dijepit di dalam kotak chart tanpa menebak (docs/06 §6.3).
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const measure = () =>
      setCardSize({
        w: element.offsetWidth || CARD_WIDTH_PX,
        h: element.offsetHeight || CARD_HEIGHT_PX,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeRefId, shown]);

  /** Posisi kartu: searah gerak titik (berlawanan ekor), dijepit di dalam kotak chart. */
  const placement = useMemo(() => {
    if (!activeItem || scale <= 0) return null;
    const tail = activeItem.tail;
    const previous = tail.length >= 2 ? tail[tail.length - 2] : null;
    return cardPlacement({
      point: { x: xScale(activeItem.rs_ratio), y: yScale(activeItem.rs_momentum) },
      previous: previous
        ? { x: xScale(previous.rs_ratio), y: yScale(previous.rs_momentum) }
        : null,
      box: { x0: 0, y0: 0, x1: VIEW_W, y1: VIEW_H },
      card: { w: cardSize.w / scale, h: cardSize.h / scale },
      gap: CARD_GAP_PX / scale,
      margin: CARD_MARGIN_PX / scale,
      pointRadius: POINT_RADIUS + FOCUS_RING_WIDTH,
      label: pointLabel(activeItem, scope),
      // ekor tanpa titik terakhir (titiknya sendiri) — kartu tidak boleh menutupinya
      tail: tail.slice(0, -1).map((point) => ({
        x: xScale(point.rs_ratio),
        y: yScale(point.rs_momentum),
      })),
    });
  }, [activeItem, scale, cardSize, xScale, yScale]);

  const points = useMemo(
    () =>
      shown.map((item) => ({
        refId: item.ref_id,
        label: pointLabel(item, scope),
        x: xScale(item.rs_ratio),
        y: yScale(item.rs_momentum),
      })),
    [shown, scope, xScale, yScale],
  );
  const labels = useMemo(
    () => (dimmed ? new Set(activeRefId ? [activeRefId] : []) : labelledRefIds(points, labelDistance)),
    [dimmed, activeRefId, points, labelDistance],
  );

  // Urutan gambar ekor: yang aktif terakhir supaya tidak tertutup (ekor tidak interaktif).
  const tailOrder = useMemo(() => {
    const others = shown.filter((item) => item.ref_id !== activeRefId);
    const active = shown.find((item) => item.ref_id === activeRefId);
    return active ? [...others, active] : others;
  }, [shown, activeRefId]);

  const centerX = xScale(AXIS_CENTER);
  const centerY = yScale(AXIS_CENTER);
  const zones: { quadrant: Quadrant; x: number; y: number; w: number; h: number; lx: number; ly: number; anchor: "start" | "end" }[] = [
    { quadrant: "improving", x: PAD, y: PAD, w: centerX - PAD, h: centerY - PAD, lx: PAD + 6, ly: PAD + 12, anchor: "start" },
    { quadrant: "leading", x: centerX, y: PAD, w: VIEW_W - PAD - centerX, h: centerY - PAD, lx: VIEW_W - PAD - 6, ly: PAD + 12, anchor: "end" },
    { quadrant: "lagging", x: PAD, y: centerY, w: centerX - PAD, h: VIEW_H - PAD - centerY, lx: PAD + 6, ly: VIEW_H - PAD - 6, anchor: "start" },
    { quadrant: "weakening", x: centerX, y: centerY, w: VIEW_W - PAD - centerX, h: VIEW_H - PAD - centerY, lx: VIEW_W - PAD - 6, ly: VIEW_H - PAD - 6, anchor: "end" },
  ];

  const moveKeyboard = (delta: number) => {
    setKeyboardIndex((prev) => {
      const next = (prev ?? 0) + delta;
      return Math.max(0, Math.min(shown.length - 1, next));
    });
  };

  /** Fokus dari klik bukan fokus keyboard → mode fokus keyboard jangan ikut menyala. */
  const focusIsKeyboard = (target: EventTarget | null): boolean => {
    try {
      return target instanceof Element ? target.matches(":focus-visible") : true;
    } catch {
      return true;
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveKeyboard(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveKeyboard(-1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        {
          const item = shown[keyboardIndex ?? 0];
          if (item) onSelect(selectedRefId === item.ref_id ? null : item.ref_id);
        }
        break;
      case "Escape":
        onSelect(null);
        setHovered(null);
        lastExternal.current?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onMouseLeave={() => setHovered(null)}
      data-testid="rrg-chart-root"
    >
      {/* kartu hover diposisikan relatif ke SVG saja (legenda & catatan di bawahnya
          membuat tinggi wadah ≠ tinggi gambar) */}
      <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="application"
        tabIndex={0}
        aria-label={`${label} — Tab untuk masuk, panah untuk pindah titik, Enter untuk pin`}
        aria-activedescendant={activeRefId ? `rrg-point-${activeRefId}` : undefined}
        className="h-auto w-full rounded-md border border-border bg-surface"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          setChartFocused(focusIsKeyboard(event.target));
          setKeyboardIndex((prev) => prev ?? 0);
        }}
        onBlur={() => setChartFocused(false)}
        onClick={(event) => {
          // klik di area kosong = lepas pin; klik titik sudah ditandai `data-point` (docs/06 §6.1)
          const target = event.target as Element | null;
          if (!target?.closest("[data-point]")) onSelect(null);
        }}
        data-testid="rrg-chart"
        data-active={activeRefId ?? ""}
        data-pinned={selectedRefId ?? ""}
      >
        {/* zona kuadran: tidak ikut meredup saat mode fokus (docs/06 §6.1) */}
        <g data-testid="rrg-zones">
          {zones.map((zone) => (
            <g key={zone.quadrant}>
              <rect
                data-testid={`zone-${zone.quadrant}`}
                x={zone.x}
                y={zone.y}
                width={zone.w}
                height={zone.h}
                opacity={1}
                style={{ fill: QUADRANT_BG[zone.quadrant] }}
              />
              <text
                x={zone.lx}
                y={zone.ly}
                textAnchor={zone.anchor}
                fontSize={10}
                letterSpacing="0.04em"
                opacity={0.55}
                className="fill-fg-muted uppercase"
              >
                {zone.quadrant}
              </text>
            </g>
          ))}
        </g>

        {/* grid + garis 100: juga tidak meredup */}
        <g data-testid="rrg-grid">
          {[axisTicks(pad)[0], axisTicks(pad)[2]].map((tick) => (
            <g key={tick}>
              <line x1={xScale(tick)} y1={PAD} x2={xScale(tick)} y2={VIEW_H - PAD} strokeWidth={1} opacity={1} style={{ stroke: "var(--border)" }} />
              <line x1={PAD} y1={yScale(tick)} x2={VIEW_W - PAD} y2={yScale(tick)} strokeWidth={1} opacity={1} style={{ stroke: "var(--border)" }} />
              <text x={xScale(tick)} y={VIEW_H - PAD + 14} textAnchor="middle" fontSize={10} className="fill-fg-faint">
                {tickLabel(tick)}
              </text>
              <text x={PAD - 6} y={yScale(tick) + 3} textAnchor="end" fontSize={10} className="fill-fg-faint">
                {tickLabel(tick)}
              </text>
            </g>
          ))}
          <line data-testid="axis-100-x" x1={centerX} y1={PAD} x2={centerX} y2={VIEW_H - PAD} strokeWidth={1.5} opacity={1} style={{ stroke: "var(--border-strong)" }} />
          <line data-testid="axis-100-y" x1={PAD} y1={centerY} x2={VIEW_W - PAD} y2={centerY} strokeWidth={1.5} opacity={1} style={{ stroke: "var(--border-strong)" }} />
          <text x={VIEW_W - PAD} y={centerY - 6} textAnchor="end" fontSize={10} letterSpacing="0.04em" className="fill-fg-muted uppercase">
            RS-Ratio →
          </text>
          <text x={centerX + 6} y={PAD + 12} fontSize={10} letterSpacing="0.04em" className="fill-fg-muted uppercase">
            RS-Momentum ↑
          </text>
        </g>

        {/* ekor digambar sebelum titik: titik aktif paling atas (docs/06 §6.1) */}
        <g data-testid="rrg-tails">
          {tailOrder.map((item) =>
            hasTail(item)
              ? item.tail.slice(0, -1).map((point, index) => {
                  const next = item.tail[index + 1];
                  const isActive = item.ref_id === activeRefId;
                  return (
                    <line
                      key={`${item.ref_id}-${index}`}
                      data-testid={`tail-${item.ref_id}-${index}`}
                      x1={xScale(point.rs_ratio)}
                      y1={yScale(point.rs_momentum)}
                      x2={xScale(next.rs_ratio)}
                      y2={yScale(next.rs_momentum)}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      opacity={isActive ? 1 : dimmed ? DIM_TAIL_OPACITY : tailSegmentOpacity(index, item.tail.length)}
                      style={{ stroke: item.color_hex }}
                      className="transition-opacity duration-[var(--motion-hover)] ease-out motion-reduce:transition-none"
                    />
                  );
                })
              : null,
          )}
        </g>

        {/* titik interaktif: urutan DOM tetap (rank) supaya hover tidak mematikan klik */}
        <g data-testid="rrg-points">
          {shown.map((item) => {
          const px = xScale(item.rs_ratio);
          const py = yScale(item.rs_momentum);
          const isActive = item.ref_id === activeRefId;
          const isPinned = item.ref_id === selectedRefId;
          const previous = hasTail(item) ? item.tail[item.tail.length - 2] : null;
          const fromX = previous ? xScale(previous.rs_ratio) : centerX;
          const fromY = previous ? yScale(previous.rs_momentum) : centerY;
          const transition = "transition-all duration-[var(--motion-panel)] ease-out motion-reduce:transition-none";

          return (
            <g
              key={item.ref_id}
              id={`rrg-point-${item.ref_id}`}
              data-point={item.ref_id}
              /* role="img": elemen tanpa role (`generic`) tidak boleh diberi aria-label (axe
                 `aria-prohibited-attr`). Interaksi keyboard tetap di tingkat chart (role
                 application + aria-activedescendant + aria-live). */
              role="img"
              aria-label={describePoint(item, scope)}
              data-testid={`point-group-${item.ref_id}`}
              transform={`translate(${mounted ? px : fromX}, ${mounted ? py : fromY})`}
              className={transition}
              onMouseEnter={() => setHovered(item.ref_id)}
              onClick={(event) => {
                // klik titik tidak boleh ikut melepas pin lewat handler area kosong
                event.stopPropagation();
                onSelect(isPinned ? null : item.ref_id);
                setKeyboardIndex(shown.indexOf(item));
              }}
            >
              {/* titik dasar tidak pernah berpindah urutan DOM — hover tidak boleh mematikan klik */}
              <circle
                data-testid={`point-${item.ref_id}`}
                r={POINT_RADIUS}
                opacity={isActive ? 1 : dimmed ? DIM_POINT_OPACITY : 1}
                fill={item.color_hex}
                strokeWidth={2}
                style={{ stroke: "var(--surface)" }}
                className={cn("cursor-pointer", transition)}
              />
              {!isActive && labels.has(item.ref_id) && (
                <text
                  data-testid={`label-${item.ref_id}`}
                  x={11}
                  y={4}
                  fontSize={11}
                  className="pointer-events-none fill-fg"
                >
                  {pointLabel(item, scope)}
                </text>
              )}
            </g>
          );
        })}
        </g>

        {/* lapisan fokus digambar paling akhir (z-order, docs/06 §6.1) dan tidak menangkap pointer,
            supaya titik interaktif di grup sebelumnya tidak ikut berpindah saat hover */}
        <g data-testid="rrg-focused" pointerEvents="none">
          {activeItem && (
            <g transform={`translate(${xScale(activeItem.rs_ratio)}, ${yScale(activeItem.rs_momentum)})`}>
              <circle
                data-testid={`point-focus-${activeItem.ref_id}`}
                r={FOCUS_RADIUS}
                opacity={1}
                fill={activeItem.color_hex}
                strokeWidth={2}
                style={{ stroke: "var(--surface)" }}
              />
              {chartFocused && (
                <circle
                  data-testid="focus-ring"
                  r={FOCUS_RADIUS + 3}
                  fill="none"
                  strokeWidth={FOCUS_RING_WIDTH}
                  style={{ stroke: "var(--focus)" }}
                />
              )}
              <text
                data-testid={`label-${activeItem.ref_id}`}
                x={12}
                y={4}
                fontSize={11}
                className="fill-fg"
              >
                {pointLabel(activeItem, scope)}
              </text>
            </g>
          )}
        </g>

      </svg>

      {activeItem && placement && (
        <div
          data-testid="point-card"
          data-side={placement.side}
          data-flipped={placement.flipped}
          className="pointer-events-none absolute z-10"
          style={{
            left: `${(placement.x / VIEW_W) * 100}%`,
            top: `${(placement.y / VIEW_H) * 100}%`,
            width: cardSize.w,
          }}
        >
          {/* kartu tidak boleh menangkap pointer: titik di baliknya harus tetap bisa di-hover/klik
              (yang tetap bisa diklik hanya tautan di dalamnya — lihat PointCard) */}
          <div className="pointer-events-none" ref={cardRef}>
            <PointCard
              item={activeItem}
              scope={scope}
              onOpenDetail={onOpenDetail ? () => onOpenDetail(activeItem.ref_id) : undefined}
            />
          </div>
        </div>
      )}
      </div>

      {hiddenCount > 0 && (
        <p className="mt-1 text-sm text-fg-muted" data-testid="rrg-cap-note">
          Menampilkan {shown.length} dari {shown.length + hiddenCount} titik (skor tertinggi).{" "}
          <Link to={showAllHref} className="text-accent underline underline-offset-2">
            Lihat semua di tabel
          </Link>
        </p>
      )}

      {/* Legenda interaktif (docs/06 §6.2): jalur kedua ke titik yang sama + jalur keyboard
          utama. Satu state dengan chart (`hovered`/`selectedRefId`), dan tidak ikut meredup.
          Tinggi kotak legenda DIPATOK (docs/06 §6.2: `max-height` 96px + scroll) supaya
          kedatangan data tidak menggeser tata letak (CLS, docs/08 F11). */}
      <div
        data-testid="rrg-legend"
        className="mt-2 flex flex-col gap-2"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onSelect(null);
            setHovered(null);
          }
        }}
      >
        {legendNeedsSearch(shown.length) && (
          <input
            type="search"
            aria-label="Cari entri legenda"
            placeholder="cari nama/ticker"
            value={legendQuery}
            onChange={(event) => setLegendQuery(event.target.value)}
            className="h-8 w-40 rounded-sm border border-border-strong bg-surface px-2 text-base text-fg"
          />
        )}
        <div className="flex h-24 flex-wrap content-start gap-2 overflow-y-auto">
          {legendEntries(shown, legendQuery).map((item) => {
            const isHovered = item.ref_id === hovered;
            const isPinned = item.ref_id === selectedRefId;
            return (
              <button
                key={item.ref_id}
                type="button"
                data-testid={`legend-${item.ref_id}`}
                aria-pressed={isPinned}
                onMouseEnter={() => setHovered(item.ref_id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(item.ref_id)}
                onBlur={() => setHovered(null)}
                onClick={() => {
                  onSelect(isPinned ? null : item.ref_id);
                  setKeyboardIndex(shown.indexOf(item));
                }}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-sm motion-reduce:transition-none",
                  isHovered
                    ? "border-border-strong bg-surface-hover ring-1 ring-[var(--focus)]"
                    : isPinned
                      ? "border-border-strong bg-accent-subtle font-medium text-fg"
                      : "border-border text-fg-muted hover:text-fg",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color_hex }}
                />
                {scope === "stock" ? (
                  <span className="max-w-40 truncate" title={item.name}>
                    {stockLabel(item)}
                  </span>
                ) : (
                  item.name
                )}
                <QuadrantBadge quadrant={item.quadrant} />
                <StreakBadge weeks={item.streak_weeks} />
                {/* pembaca layar dapat angkanya (docs/06 §6.2) */}
                <span className="sr-only">
                  {`${QUADRANT_LABEL[item.quadrant]}, RS-Ratio ${formatNum(item.rs_ratio, 2)}, RS-Momentum ${formatNum(item.rs_momentum, 2)}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" data-testid="rrg-live" className="sr-only">
        {activeItem ? describePoint(activeItem, scope) : ""}
      </p>
    </div>
  );
}
