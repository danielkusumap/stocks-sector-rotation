import { formatDelta, formatPct } from "../../lib/format";

/**
 * Angka perubahan dengan tanda eksplisit + warna arah (docs/06 §4: tanda selalu ada,
 * warna hanya pelengkap). Format angka tetap dari `lib/format.ts`.
 */
export function Delta({
  value,
  unit = "pct",
  decimals,
}: {
  value: number | null | undefined;
  /** "pct" → "+1,81%" · "plain" → "+0,42" (dipakai kolom Δ RS). */
  unit?: "pct" | "plain";
  decimals?: number;
}) {
  const text = unit === "pct" ? formatPct(value, decimals) : formatDelta(value, decimals);
  const tone =
    value === null || value === undefined || !Number.isFinite(value) || value === 0
      ? "text-fg-muted"
      : value > 0
        ? "text-up"
        : "text-down";
  return <span className={`font-mono ${tone}`}>{text}</span>;
}
