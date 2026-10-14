import { Link } from "react-router";
import type { PlanPick } from "../../lib/api";
import { formatNum, formatRp, formatRpCompact } from "../../lib/format";
import {
  REGIME_LABEL,
  TONE_CLASS,
  cardFigures,
  levelRows,
  reasonRows,
  runningText,
  statusLabel,
  zoneLabel,
  PICK_STATUS_TONE,
} from "../../lib/swingPicks";
import { LevelRuler } from "../charts/LevelRuler";

/**
 * Satu kartu pick (docs/08 F25 butir 4). Semua angka dari `GET /plan/picks`; kartu hanya
 * menyusunnya. Detil level ada di disclosure "Kenapa level ini?" supaya kartu tidak memanjang.
 */
export function PickCard({
  pick,
  sector,
}: {
  pick: PlanPick;
  /** Nama + token warna sektor dari `GET /meta/sectors` (jangan hardcode warna). */
  sector?: { name: string; colorToken: string } | null;
}) {
  const status = statusLabel(pick.status);
  const tone = pick.status ? PICK_STATUS_TONE[pick.status] : "muted";
  const running = runningText(pick);
  const reasons = reasonRows(pick);

  return (
    <article
      data-testid={`pick-${pick.ticker}`}
      data-status={pick.status ?? "baru"}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold" data-testid={`pick-ticker-${pick.ticker}`}>
          {pick.ticker}
        </span>
        <span className="text-sm text-fg-muted">{pick.name}</span>
        {sector && (
          <span
            data-testid={`pick-sector-${pick.ticker}`}
            className="inline-flex h-5 items-center rounded-sm border border-border px-1.5 text-sm"
            style={{ color: `var(--${sector.colorToken})`, borderColor: `var(--${sector.colorToken})` }}
          >
            {sector.name}
          </span>
        )}
        <span className="inline-flex h-5 items-center rounded-sm bg-bg-subtle px-1.5 text-sm text-fg-muted">
          {pick.regime_label ?? REGIME_LABEL[pick.regime] ?? pick.regime}
        </span>
        <span
          data-testid={`pick-zone-badge-${pick.ticker}`}
          className="inline-flex h-5 items-center rounded-sm bg-bg-subtle px-1.5 text-sm"
        >
          {zoneLabel(pick)}
        </span>
        {status && (
          <span data-testid={`pick-status-${pick.ticker}`} className={`inline-flex h-5 items-center gap-1 text-sm ${TONE_CLASS[tone]}`}>
            <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current" />
            {status}
          </span>
        )}
        <span className="ml-auto font-mono text-sm text-fg-muted" data-testid={`pick-rank-${pick.ticker}`}>
          {pick.rank ? `#${formatNum(pick.rank)} · ` : ""}skor {formatNum(pick.skor, 2)}
        </span>
      </header>

      {/* baris angka: semua dari API */}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid={`pick-figures-${pick.ticker}`}>
        {cardFigures(pick).map((figure) => (
          <div key={figure.key} className="flex items-baseline gap-1.5">
            <dt className="text-fg-muted">{figure.label}</dt>
            <dd className="font-mono tabular-nums" data-figure={figure.key}>
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>

      <LevelRuler pick={pick} />

      {/* rencana 2 kolom */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2" data-testid={`pick-plan-${pick.ticker}`}>
        {levelRows(pick).map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-2">
            <dt className="text-fg-muted">{row.label}</dt>
            <dd className="font-mono tabular-nums" data-plan-row={row.key}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {reasons.length > 0 && (
        <details data-testid={`pick-reasons-${pick.ticker}`} className="text-sm">
          <summary className="cursor-pointer text-fg-muted">Kenapa level ini?</summary>
          <dl className="mt-1 flex flex-col gap-0.5 pl-3">
            {reasons.map((row) => (
              <div key={row.key}>
                <dt className="text-fg-muted">{row.label}</dt>
                <dd>{row.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {pick.validity && (
        <details data-testid={`pick-validity-${pick.ticker}`} className="text-sm">
          <summary className="cursor-pointer text-fg-muted">Sampai kapan sah?</summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {pick.validity.valid_until && <li>sah sampai: {pick.validity.valid_until}</li>}
            {pick.validity.valid_if && <li>sah bila: {pick.validity.valid_if}</li>}
            {pick.validity.invalidate_below !== null && pick.validity.invalidate_below !== undefined && (
              <li>batal bila di bawah {formatRp(pick.validity.invalidate_below)}</li>
            )}
            {pick.validity.expires_if && <li>gugur: {pick.validity.expires_if}</li>}
            {pick.validity.done_if && <li>selesai: {pick.validity.done_if}</li>}
          </ul>
        </details>
      )}

      {running && (
        <p className="text-sm text-fg-muted" data-testid={`pick-running-${pick.ticker}`}>
          {pick.status_note ? `${pick.status_note} · ` : ""}
          {running}
        </p>
      )}

      {(pick.notes?.length ?? 0) > 0 && (
        <ul className="text-sm text-warn" data-testid={`pick-notes-${pick.ticker}`}>
          {pick.notes!.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <footer className="flex items-center gap-3 text-sm">
        <Link className="text-accent underline" to={`/stocks/${pick.ticker}`} data-testid={`pick-link-${pick.ticker}`}>
          Buka detail
        </Link>
        <span className="text-fg-faint">harga penyesuaian · transaksi {formatRpCompact(pick.turnover_idr)}/hari</span>
      </footer>
    </article>
  );
}
