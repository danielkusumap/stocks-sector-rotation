import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import AppShell from "./components/layout/AppShell";
import OverviewPage from "./pages/OverviewPage";
import SectorPage from "./pages/SectorPage";
import StockPage from "./pages/StockPage";
import StatusPage from "./pages/StatusPage";
import WeeklyPage from "./pages/WeeklyPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="/sectors" element={<SectorPage />} />
          <Route path="/stocks" element={<StockPage />} />
          <Route path="/weekly" element={<WeeklyPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
