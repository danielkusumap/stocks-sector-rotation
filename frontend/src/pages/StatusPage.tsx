import { Link } from "react-router";
import { RunHistory } from "../components/domain/RunHistory";
import { ErrorState } from "../components/ui/ErrorState";
import { Panel } from "../components/ui/Panel";
import { Pill } from "../components/ui/Pill";
import { Skeleton } from "../components/ui/Skeleton";
import { Table, Td, Th } from "../components/ui/Table";
import { useFreshness, useMetaConfig, useRuns } from "../hooks/useApiQuery";
import { formatDateTime } from "../lib/format";
import { configRows, dailyFreshnessText, gateView, probeRows } from "../lib/runStatus";

/**
 * Halaman Status (docs/08 F10) — **baca-saja**: kondisi kesegaran data, riwayat run,
 * dan config aktif. Tombol pipeline hanya ada di `/data` (F12); di sini cukup tautan.
 */
export default function StatusPage() {
  const freshness = useFreshness();
  const config = useMetaConfig();
  const runsQuery = useRuns(20);
  const runs = runsQuery.data?.runs ?? [];

  const gate = gateView(freshness.data);
  const probes = probeRows(freshness.data);
  const rows = configRows(config.data);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-md font-semibold">Status data</h2>
          <p className="text-sm text-fg-muted">
            Kondisi data terakhir dan riwayat proses. Halaman ini tidak mengubah apa pun — untuk
            menjalankan pipeline, buka halaman Data.
          </p>
        </div>
        <Link to="/data" className="ml-auto text-sm text-accent underline underline-offset-2">
          Buka halaman Data
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <Panel title="Gate tengah hari">
          {freshness.isPending ? (
            <div className="p-3">
              <Skeleton className="h-10 w-64" />
            </div>
          ) : freshness.isError ? (
            <ErrorState error={freshness.error} onRetry={() => void freshness.refetch()} />
          ) : (
            <div className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Pill
                  tone={gate.tone}
                  label={gate.label}
                  className="rounded-sm border border-border-strong px-3 py-1 text-lg font-semibold"
                />
                <span className="text-sm text-fg-muted">{gate.detail}</span>
              </div>
              {/* AC F10: `stale` wajib punya kalimat tindakan, bukan cuma warna */}
              {gate.action && <p className="text-sm text-warn">{gate.action}</p>}
              <p className="text-sm text-fg-muted">{dailyFreshnessText(freshness.data)}</p>
              {probes.length > 0 && (
                <Table caption="Waktu bar terakhir per ticker probe">
                  <thead>
                    <tr>
                      <Th>Ticker probe</Th>
                      <Th>Bar terakhir</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {probes.map((probe) => (
                      <tr key={probe.ticker}>
                        <Td className="font-mono text-sm">{probe.ticker}</Td>
                        <Td className="font-mono text-sm">{formatDateTime(probe.last_bar_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </Panel>

        <Panel
          title="Konfigurasi aktif"
          actions={<span className="text-sm text-fg-muted">config/default.yaml</span>}
        >
          {config.isPending ? (
            <div className="p-3">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : config.isError ? (
            <ErrorState error={config.error} onRetry={() => void config.refetch()} />
          ) : rows.length === 0 ? (
            <p className="p-3 text-sm text-fg-muted">Server belum mengirim konfigurasi aktif.</p>
          ) : (
            <dl className="grid gap-x-6 p-3 sm:grid-cols-2">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-3 border-b border-border py-1"
                >
                  <dt className="text-sm text-fg-muted">{row.label}</dt>
                  <dd className="font-mono text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <RunHistory runs={runs} error={runsQuery.isError ? runsQuery.error : null} />
      </div>
    </>
  );
}
