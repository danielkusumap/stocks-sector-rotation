import { Link } from "react-router";
import type { ReactNode } from "react";
import type { RrgItem } from "../../lib/api";
import { formatNum, formatRpCompact } from "../../lib/format";
import { QUADRANT_DESC, QUADRANT_LABEL } from "../../lib/quadrant";
import { Delta } from "../ui/Delta";

/**
 * Kartu detail satu titik RRG (docs/06 §5). Angka berasal dari item `/rrg` yang sama
 * dengan tabel, jadi tidak ada perhitungan di sini. `streak_weeks` dan perubahan
 * RS belum ada di `/rrg` (docs/05 §2) — dicatat sebagai blocker, bukan dikarang.
 */
export function PointCard({ item }: { item: RrgItem }) {
  return (
    <div className="w-60 rounded-md border border-border bg-surface p-3 text-left shadow-float">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: item.color_hex }}
        />
        <p className="font-medium">{item.name}</p>
      </div>
      <p className="mt-0.5 text-sm text-fg-muted">
        {QUADRANT_LABEL[item.quadrant]} · {item.quadrant_age_periods} periode
        {item.transition ? ` · ${item.transition}` : ""}
      </p>
      <p className="mt-0.5 text-sm text-fg-muted">{QUADRANT_DESC[item.quadrant]}</p>

      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <Row label="RS-Ratio" value={formatNum(item.rs_ratio, 2)} />
        <Row label="RS-Momentum" value={formatNum(item.rs_momentum, 2)} />
        <Row label="1 minggu" value={<Delta value={item.ret_1w} />} />
        <Row label="Turnover 20h" value={formatRpCompact(item.median_turnover_20d_idr)} />
        <Row label="Skor" value={formatNum(item.score, 1)} />
      </dl>

      {item.tail.length < 2 && (
        <p className="mt-1 text-sm text-fg-faint">ekor belum tersedia (data &lt; 2 periode)</p>
      )}

      <div className="mt-2 flex justify-end">
        <Link
          to={`/stocks?sector=${item.ref_id}`}
          className="text-sm text-accent underline underline-offset-2"
        >
          Lihat saham sektor ini
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
