import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ledgerClient, selectBackend } from "./api/ledgerClient";
import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      client={ledgerClient()}
      signInMethod={
        selectBackend(
          window.location.search,
          import.meta.env.VITE_LEDGER_BACKEND,
        ) === "fake"
          ? { kind: "fake" }
          : { kind: "google", clientId: import.meta.env.GOOGLE_CLIENT_ID }
      }
    />
  </StrictMode>,
);
