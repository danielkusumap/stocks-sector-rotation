import { useState } from "react";
import { QuadrantChart } from "../components/charts/QuadrantChart";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Delta } from "../components/ui/Delta";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { FreshnessPill } from "../components/ui/FreshnessPill";
import { Panel } from "../components/ui/Panel";
import { Pill } from "../components/ui/Pill";
import { Popover } from "../components/ui/Popover";
import { ProgressBar } from "../components/ui/ProgressBar";
import { QuadrantBadge } from "../components/ui/QuadrantBadge";
import { Segmented } from "../components/ui/Segmented";
import { Select } from "../components/ui/Select";
import { Skeleton, TableSkeleton } from "../components/ui/Skeleton";
import { StatCard } from "../components/ui/StatCard";
import { StreakBadge } from "../components/ui/StreakBadge";
import { Table, Td, Th } from "../components/ui/Table";
import { ToastStack, useToasts } from "../components/ui/Toast";
import { Tooltip } from "../components/ui/Tooltip";
import { useTheme, type Theme } from "../hooks/useTheme";
import { useRrg } from "../hooks/useApiQuery";
import { ApiError, type DataStatus, type Dir } from "../lib/api";
import { formatPct, formatRp, formatRpCompact } from "../lib/format";
import { QUADRANTS } from "../lib/api";

/**
 * Halaman uji komponen (dev-only): hanya terdaftar sebagai route saat `import.meta.env.DEV`,
 * jadi tidak ikut ke bundle produksi (docs/08 F2).
 */
export default function PlaygroundPage() {
  const { theme, setTheme } = useTheme();
  const { items: toasts, push, dismiss } = useToasts();
  const [check, setCheck] = useState(true);
  const [window, setWindow] = useState<"1w" | "1m" | "3m" | "6m" | "1y" | "ytd">("3m");
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: "score", dir: "desc" });

  const stale: DataStatus = {
    as_of: "2026-10-12",
    timeframe: "w1_fri",
    status: "stale",
    last_data_at: "2026-10-12T16:10:00+07:00",
    computed_at: "2026-10-12T16:31:02+07:00",
    partial_sectors: [],
  };
  const partial: DataStatus = { ...stale, status: "partial", partial_sectors: ["IDXINDUST", "IDXTRANS"] };
  const ok: DataStatus = { ...stale, status: "ok" };

  return (
    <>
      <div className="mb-3 flex items-end gap-3">
        <div>
          <h2 className="text-md font-semibold">Playground komponen</h2>
          <p className="text-sm text-fg-muted">
            Semua komponen dasar (docs/08 F2). Halaman ini hanya ada di mode dev.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segmented<Theme>
            label="Tema"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Terang" },
              { value: "dark", label: "Gelap" },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Button, Badge, Pill">
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Jalankan</Button>
              <Button>Muat ulang</Button>
              <Button variant="ghost">Batal</Button>
              <Button disabled>Nonaktif</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge title="Papan Pemantauan Khusus">PK</Badge>
              <Badge>962</Badge>
              <Pill tone="ok" label="data 12 Okt 2026 16:10" />
              <Pill tone="stale" label="delay" />
              <Pill tone="partial" label="2 sektor tipis" />
              <Pill tone="failed" label="gagal" bold />
              <Pill tone="running" label="jalan" />
            </div>
            <div className="flex items-center gap-4 text-base">
              <Delta value={0.0181} />
              <Delta value={-0.0045} />
              <Delta value={0} />
              <Delta value={null} />
              <Delta value={0.42} unit="plain" />
            </div>
          </div>
        </Panel>

        <Panel title="Segmented, Select, Popover, Tooltip">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <Segmented
              label="Jendela"
              value={window}
              onChange={setWindow}
              options={[
                { value: "1w", label: "1B" },
                { value: "1m", label: "1M" },
                { value: "3m", label: "3M" },
                { value: "6m", label: "6B" },
                { value: "ytd", label: "YTD" },
                { value: "1y", label: "1T", disabled: true, title: "belum tersedia" },
              ]}
            />
            <Select
              label="Urutkan"
              value={sort.key}
              onChange={(key) => setSort((s) => ({ ...s, key }))}
              options={[
                { value: "score", label: "Skor" },
                { value: "rs_ratio", label: "RS-Ratio" },
                { value: "rank_score", label: "Peringkat" },
              ]}
            />
            <Popover
              trigger={<Button>Popover</Button>}
              className="w-64"
            >
              <p className="text-sm text-fg-muted">Isi popover: detail angka tanpa keluar halaman.</p>
            </Popover>
            <Tooltip label="tersedia setelah penutupan Jumat">
              <Button variant="ghost">Mingguan (Sen–Jum)</Button>
            </Tooltip>
            <Button onClick={() => setDialog(true)}>Dialog konfirmasi</Button>
            <Button onClick={() => setDrawer(true)}>Buka drawer</Button>
            <label className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={check}
                onChange={(e) => setCheck(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              contoh kontrol native
            </label>
          </div>
        </Panel>

        <Panel title="Kuadran, streak, kesegaran">
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
              {QUADRANTS.map((quadrant) => (
                <QuadrantBadge key={quadrant} quadrant={quadrant} />
              ))}
              <QuadrantBadge quadrant={null} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StreakBadge weeks={1} /> <span className="text-sm text-fg-muted">(1w disembunyikan)</span>
              <StreakBadge weeks={2} />
              <StreakBadge weeks={3} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <FreshnessPill status={ok} />
              <FreshnessPill status={stale} />
              <FreshnessPill status={partial} />
            </div>
            <ProgressBar percent={40.5} message="batch 9/20" />
            <ProgressBar percent={null} message="menunggu antrean" />
          </div>
        </Panel>

        <Panel title="StatCard, skeleton, keadaan kosong & galat">
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="IHSG"
                value={formatRp(5936.15)}
                delta={<Delta value={-0.0259} />}
              />
              <StatCard
                label="Turnover keuangan"
                value={formatRpCompact(1_180_000_000_000)}
                delta={<Delta value={0.0181} />}
                note="20 hari bursa"
              />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
            <TableSkeleton rows={3} cols={4} />
            <EmptyState
              title="Tidak ada baris yang cocok"
              hint="Coba longgarkan filter."
              action={<Button>Reset filter</Button>}
            />
            <ErrorState
              error={new ApiError(500, "db_locked", "Database sedang dikunci proses lain")}
              onRetry={() => undefined}
            />
            <div className="flex gap-2">
              <Button onClick={() => push("ok", "Contoh toast selesai.")}>Toast OK</Button>
              <Button onClick={() => push("warn", "Contoh toast gagal.")}>Toast gagal</Button>
              <Button onClick={() => push("info", "Contoh toast info.")}>Toast info</Button>
            </div>
          </div>
        </Panel>

        <Panel title="QuadrantChart (RRG) — 3 variasi" className="lg:col-span-2">
          <div className="flex flex-col gap-4 p-3">
            <ChartDemo
              title="Sektor (11 titik, ekor 3)"
              testId="chart-demo-sector"
              params={{ scope: "sector" }}
              note="normal → hover → pin"
            />
            <ChartDemo
              title="Saham satu sektor (60 titik → dipotong 25)"
              testId="chart-demo-stocks"
              params={{ scope: "stock", sector: ["IDXFINANCE"] }}
              showAllHref="/stocks?sector=IDXFINANCE"
              note="AC F4 #6"
            />
            <ChartDemo
              title="Tanpa ekor (tail_points=1)"
              testId="chart-demo-notail"
              params={{ scope: "sector", tail_points: 1 }}
              note="AC F4 #5 — hanya titik, tanpa error"
            />
          </div>
        </Panel>

        <Panel title="Tabel (header sortable)">
          <Table caption="Contoh tabel sektor dengan header yang bisa diurutkan">
            <thead>
              <tr>
                <Th>Sektor</Th>
                <Th
                  align="right"
                  sortable
                  active={sort.key === "score"}
                  dir={sort.dir}
                  onSort={(dir) => setSort({ key: "score", dir })}
                >
                  Skor
                </Th>
                <Th
                  align="right"
                  sortable
                  active={sort.key === "rs_ratio"}
                  dir={sort.dir}
                  onSort={(dir) => setSort({ key: "rs_ratio", dir })}
                >
                  RS-Ratio
                </Th>
                <Th align="right">1B</Th>
                <Th align="right">Turnover</Th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Keuangan", 87.4, 102.31, 0.0181, 1_180_000_000_000],
                ["Kesehatan", 71.2, 101.06, 0.0092, 412_000_000_000],
                ["Infrastruktur", 58.6, 98.74, -0.008, 245_000_000_000],
              ].map(([name, score, rs, ret, turnover]) => (
                <tr key={String(name)}>
                  <Td>{name}</Td>
                  <Td align="right" className="font-mono">
                    {Number(score).toFixed(1).replace(".", ",")}
                  </Td>
                  <Td align="right" className="font-mono">
                    {Number(rs).toFixed(2).replace(".", ",")}
                  </Td>
                  <Td align="right">
                    <Delta value={Number(ret)} />
                  </Td>
                  <Td align="right" className="font-mono text-fg-muted">
                    {formatRpCompact(Number(turnover))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="p-3 text-sm text-fg-muted">
            Urutan aktif: {sort.key} {sort.dir} · contoh delta: {formatPct(0.0181)}
          </p>
        </Panel>
      </div>

      <Drawer open={drawer} onOpenChange={setDrawer} title="Contoh drawer 720px">
        <p className="text-base text-fg-muted">
          Fokus terkunci di panel ini; Esc atau klik luar menutup dan fokus kembali ke tombol pemicu.
        </p>
      </Drawer>

      <ConfirmDialog
        open={dialog}
        title="Contoh dialog konfirmasi"
        confirmLabel="Ya, lanjutkan"
        onCancel={() => setDialog(false)}
        onConfirm={() => {
          setDialog(false);
          push("info", "Konfirmasi diterima.");
        }}
      >
        Dialog ini memakai elemen <span className="font-mono">&lt;dialog&gt;</span> native.
      </ConfirmDialog>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </>
  );
}

/** Contoh chart untuk playground: sektor, saham (dipotong 25), dan tanpa ekor. */
function ChartDemo({
  title,
  testId,
  params,
  note,
  showAllHref,
}: {
  title: string;
  testId: string;
  params: Parameters<typeof useRrg>[0];
  note?: string;
  showAllHref?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rrg = useRrg(params);

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-medium">{title}</p>
        {note && <p className="text-sm text-fg-muted">— {note}</p>}
        <p className="ml-auto text-sm text-fg-muted">
          titik: {rrg.data?.items.length ?? "…"} · pin: {selected ?? "—"}
        </p>
      </div>
      {rrg.isError ? (
        <ErrorState error={rrg.error} onRetry={() => void rrg.refetch()} />
      ) : rrg.isPending ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
        <QuadrantChart
          items={rrg.data.items}
          scope={params.scope ?? "sector"}
          selectedRefId={selected}
          onSelect={setSelected}
          label={title}
          showAllHref={showAllHref}
        />
      )}
    </div>
  );
}
