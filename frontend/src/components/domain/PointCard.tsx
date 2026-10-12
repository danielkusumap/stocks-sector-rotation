import { Link } from "react-router";
import type { ReactNode } from "react";
import type { RrgItem } from "../../lib/api";
import { formatNum, formatRpCompact } from "../../lib/format";
import { QUADRANT_DESC, QUADRANT_LABEL } from "../../lib/quadrant";
import { Delta } from "../ui/Delta";
import { StreakBadge } from "../ui/StreakBadge";

/**
 * Kartu detail satu titik RRG (docs/06 §5). Angka berasal dari item `/rrg` yang sama
 * dengan tabel, jadi tidak ada perhitungan di sini. `rs_*_change_1p` boleh `null`
 * (docs/05 §2 → tampil "—") dan `streak_weeks` = 0 (badge tidak muncul).
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
        <StreakBadge weeks={item.streak_weeks ?? 0} />
      </div>
      <p className="mt-0.5 text-sm text-fg-muted">
        {QUADRANT_LABEL[item.quadrant]} · {item.quadrant_age_periods} periode
        {item.transition ? ` · ${item.transition}` : ""}
      </p>
      <p className="mt-0.5 text-sm text-fg-muted">{QUADRANT_DESC[item.quadrant]}</p>

      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <Row
          label="RS-Ratio"
          value={<span data-testid="point-card-rs-ratio">{formatNum(item.rs_ratio, 2)}</span>}
          extra={<Delta value={item.rs_ratio_change_1p} unit="plain" />}
        />
        <Row
          label="RS-Momentum"
          value={<span data-testid="point-card-rs-momentum">{formatNum(item.rs_momentum, 2)}</span>}
          extra={<Delta value={item.rs_momentum_change_1p} unit="plain" />}
        />
        <Row label="1 minggu" value={<Delta value={item.ret_1w} />} />
        <Row label="Turnover 20h" value={formatRpCompact(item.median_turnover_20d_idr)} />
        <Row label="Skor" value={formatNum(item.score, 1)} />
      </dl>
      <p className="mt-1 text-xs text-fg-faint">Δ1p = perubahan 1 periode</p>

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

function Row({ label, value, extra }: { label: string; value: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="flex items-baseline gap-2 font-mono">
        {value}
        {extra}
      </dd>
    </div>
  );
}
