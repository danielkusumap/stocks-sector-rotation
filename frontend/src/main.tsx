import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

/** MSW hidup di dev supaya UI bisa dibangun sebelum backend siap; matikan dengan `VITE_MOCKS=off`. */
async function enableMocks() {
  if (!import.meta.env.DEV || import.meta.env.VITE_MOCKS === "off") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledFrame: "bypass" });
}

enableMocks().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
