import { QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AuthGate } from "./components/layout/AuthGate";
import AppShell from "./components/layout/AppShell";
import { PeriodProvider } from "./components/layout/ScopeControls";
import { hasCredentials } from "./lib/api";
import { queryClient } from "./lib/queryClient";
import DataPage from "./pages/DataPage";
import OverviewPage from "./pages/OverviewPage";
import SectorPage from "./pages/SectorPage";
import StockPage from "./pages/StockPage";
import StatusPage from "./pages/StatusPage";
import SwingPage from "./pages/SwingPage";
import WeeklyPage from "./pages/WeeklyPage";

// Playground komponen hanya ada di dev → tidak ikut bundle produksi (docs/08 F2).
const PlaygroundPage = import.meta.env.DEV ? lazy(() => import("./pages/PlaygroundPage")) : null;

export default function App() {
  // Di build produksi (dilayani nginx dengan basic auth) kredensial diminta SEKALI di depan, sebelum
  // request apa pun dikirim — kalau tidak, tiap request kena 401 dan browser memunculkan dialognya
  // sendiri di tiap navigasi. Di dev/e2e (Vite, tanpa nginx) gerbang ini mati.
  const [ready, setReady] = useState(() => !import.meta.env.PROD || hasCredentials());
  if (!ready) return <AuthGate onSaved={() => setReady(true)} />;

  return (
    <QueryClientProvider client={queryClient}>
      <PeriodProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="/sectors" element={<SectorPage />} />
              <Route path="/stocks" element={<StockPage />} />
              <Route path="/stocks/:ticker" element={<StockPage />} />
              <Route path="/swing" element={<SwingPage />} />
              <Route path="/weekly" element={<WeeklyPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/data" element={<DataPage />} />
              {PlaygroundPage && (
                <Route
                  path="/playground"
                  element={
                    <Suspense fallback={null}>
                      <PlaygroundPage />
                    </Suspense>
                  }
                />
              )}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PeriodProvider>
    </QueryClientProvider>
  );
}
