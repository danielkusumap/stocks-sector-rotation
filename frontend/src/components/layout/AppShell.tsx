import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  Activity,
  CalendarCheck,
  Database,
  LayoutGrid,
  Layers,
  LineChart,
  Moon,
  PanelLeft,
  Sun,
} from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { useFilterState } from "../../hooks/useFilterState";
import { AsOfPicker } from "../domain/AsOfPicker";
import { ScopeControls } from "./ScopeControls";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/sectors", label: "Sektor", icon: Layers },
  { to: "/stocks", label: "Saham", icon: LineChart },
  { to: "/weekly", label: "Weekly", icon: CalendarCheck },
  { to: "/status", label: "Status", icon: Activity },
  { to: "/data", label: "Data", icon: Database },
];

export default function AppShell() {
  const [open, setOpen] = useState(true);
  const { theme, toggle } = useTheme();
  const { filters, setFilters } = useFilterState();
  const { pathname } = useLocation();
  const title =
    [...NAV].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))
      ?.label ?? "Overview";

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2"
      >
        Lewati ke konten
      </a>

      <aside
        className={`flex shrink-0 flex-col border-r border-border bg-bg-subtle transition-[width] duration-[var(--motion-panel)] ease-out ${
          open ? "w-[216px]" : "w-16"
        }`}
      >
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="font-mono text-md font-semibold">{open ? "IDX-RRG" : "IR"}</span>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Tutup label menu" : "Buka label menu"}
            aria-expanded={open}
            className="ml-auto rounded-sm p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <PanelLeft size={16} strokeWidth={1.75} />
          </button>
        </div>

        <nav aria-label="Menu utama" className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                `flex h-9 items-center gap-2.5 rounded-md px-2.5 ${
                  isActive
                    ? "bg-accent-subtle font-medium text-fg [&_svg]:text-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                }`
              }
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {open && <span className="text-base">{label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <h1 className="text-base font-semibold">{title}</h1>
          <span className="text-sm text-fg-faint">Sector Rotation IDX</span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Timeframe + Jendela + label periode di topbar (docs/06 §8, docs/08 F13 B/C) */}
            <ScopeControls filters={filters} setFilters={setFilters} />
            {/* AsOfPicker di topbar (docs/06 §5): satu tempat untuk semua halaman */}
            <AsOfPicker
              value={filters.as_of}
              onChange={(date) => setFilters({ as_of: date })}
              timeframe={filters.timeframe}
            />
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
              className="rounded-sm p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              {theme === "dark" ? (
                <Sun size={16} strokeWidth={1.75} />
              ) : (
                <Moon size={16} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </header>

        <main id="konten" className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[1680px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
