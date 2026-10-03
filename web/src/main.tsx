import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ledgerClient, selectBackend } from "./api/ledgerClient";
import { App } from "./App";
import { readGoogleClientId } from "./signIn/googleClientId";
import "./theme/default.css";
import "./theme/scope.css";
import "./styles/app.css";
import "./styles/modeScreen.css";
import "./styles/tasksPage.css";
import "./styles/taskPage.css";

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
          : { kind: "google", clientId: readGoogleClientId() }
      }
    />
  </StrictMode>,
);
