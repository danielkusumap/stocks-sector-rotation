import type { SectorSeriesResponse } from "../../lib/api";
import { formatNum } from "../../lib/format";
import { base100, combinedRange, polyline } from "../../lib/seriesChart";

const WIDTH = 320;
const HEIGHT = 96;

/**
 * `SectorSeries` mini (docs/06 §5 & F6): garis indeks sektor + IHSG. Keduanya digambar
 * pada **basis 100 di titik awal** supaya dua skala berbeda (indeks ≈ 104 vs IHSG ≈ 6.031)
 * bisa dibandingkan dalam satu gambar; angkanya sendiri tetap datang dari API
 * (label menunjukkan RS terakhir) — tidak ada rumus finansial yang dihitung di sini.
 */
export function SectorSeries({ data, className }: { data: SectorSeriesResponse; className?: string }) {
  const index = base100(data.points.map((point) => point.index_close));
  const bench = base100(data.points.map((point) => point.bench_close));
  const last = data.points.at(-1);

  if (index.length < 2) {
    return <p className="text-sm text-fg-faint">Seri belum tersedia (data &lt; 2 titik).</p>;
  }

  const range = combinedRange(index, bench);
  const shift = (values: number[]) =>
    values.map((value) => value - range.min + (range.max - range.min) * 0.1);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-24 w-full"
        role="img"
        aria-label={`Seri indeks ${data.code} dibanding IHSG, basis 100 di titik awal`}
        data-testid="sector-series"
      >
        <polyline
          points={polyline(shift(bench), WIDTH, HEIGHT, 2)}
          fill="none"
          strokeWidth={1.25}
          strokeDasharray="3 3"
          stroke="var(--fg-faint)"
        />
        <polyline
          points={polyline(shift(index), WIDTH, HEIGHT, 2)}
          fill="none"
          strokeWidth={1.75}
          stroke="var(--accent)"
        />
      </svg>
      <p className="mt-1 flex items-center gap-3 text-xs text-fg-muted" data-testid="sector-series-legend">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="h-0.5 w-4 bg-accent" />
          {data.code}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="h-0.5 w-4 border-t border-dashed border-fg-faint" />
          IHSG
        </span>
        <span className="ml-auto font-mono tabular-nums">
          {last ? `RS ${formatNum(last.rs, 2)}` : "—"}
        </span>
      </p>
      <p className="text-xs text-fg-faint">kedua garis dipakai pada basis 100 di titik awal</p>
    </div>
  );
}
