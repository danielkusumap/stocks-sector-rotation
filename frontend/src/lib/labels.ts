import type { DataStatus } from "./api";
import { formatDateTime } from "./format";

/** Label badge streak: hanya muncul sejak 2 minggu berturut-turut (docs/06 §5, AC F9). */
export function streakLabel(weeks: number): string | null {
  return weeks >= 2 ? `${weeks}w` : null;
}

/** Label ringkas kesegaran data (docs/06 §5): ok / stale / partial. */
export function freshnessLabel(status: DataStatus): string {
  if (status.status === "ok") return `data ${formatDateTime(status.last_data_at)}`;
  if (status.status === "stale") return "delay";
  return `${status.partial_sectors.length} sektor tipis`;
}

export function freshnessDetail(status: DataStatus): string {
  return status.partial_sectors.length > 0 ? status.partial_sectors.join(", ") : "tidak ada";
}
