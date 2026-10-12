/**
 * Helper chart seri (dipakai `SectorSeries`; `Sparkline` di F8). Semua fungsi di sini hanya
 * memetakan angka ke koordinat gambar — tidak ada rumus finansial yang dihitung ulang
 * (docs/05 §5.3); angka yang ditampilkan sebagai teks selalu datang dari API.
 */

/** Basis 100 di titik pertama supaya dua seri beda skala (indeks vs IHSG) bisa dibandingkan. */
export function base100(values: number[]): number[] {
  const first = values.find((value) => Number.isFinite(value) && value !== 0);
  if (first === undefined) return values.map(() => 100);
  return values.map((value) => (Number.isFinite(value) ? (value / first) * 100 : 100));
}

/** Deret angka → `points` SVG (`x,y x,y …`), sumbu y dibalik (SVG y ke bawah). */
export function polyline(values: number[], width: number, height: number, pad = 2): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `${pad},${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(" ");
}

/** Rentang gabungan dua seri supaya keduanya digambar pada satu skala. */
export function combinedRange(...series: number[][]): { min: number; max: number } {
  const all = series.flat().filter((value) => Number.isFinite(value));
  if (all.length === 0) return { min: 100, max: 100 };
  return { min: Math.min(...all), max: Math.max(...all) };
}
