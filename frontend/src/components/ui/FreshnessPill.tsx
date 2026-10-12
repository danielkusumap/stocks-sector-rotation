import type { DataStatus } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { freshnessDetail, freshnessLabel } from "../../lib/labels";
import { Pill } from "./Pill";
import { Popover } from "./Popover";

export function FreshnessPill({ status }: { status: DataStatus }) {
  return (
    <Popover
      align="end"
      className="w-72"
      trigger={
        <button type="button" className="rounded-sm px-1 py-0.5 hover:bg-surface-hover">
          <Pill tone={status.status} label={freshnessLabel(status)} />
        </button>
      }
    >
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="Status" value={status.status} />
        <Row label="as_of" value={status.as_of} />
        <Row label="Timeframe" value={status.timeframe} />
        <Row label="Data terakhir" value={formatDateTime(status.last_data_at)} />
        <Row label="Dihitung" value={formatDateTime(status.computed_at)} />
        <Row label="Sektor tipis" value={freshnessDetail(status)} />
      </dl>
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
