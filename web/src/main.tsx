import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { guestLedger, ledger, selectBackend } from "./api/selectLedger";
import { App } from "./App";
import { readGoogleClientId } from "./signIn/googleClientId";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/tiro-devanagari-sanskrit/400.css";
import "./theme/default.css";
import "./theme/scope.css";
import "./styles/app.css";
import "./styles/modeScreen.css";
import "./styles/tasksPage.css";
import "./styles/taskPage.css";
import "./styles/settingsPage.css";
import "./styles/report.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      client={ledger()}
      guest={guestLedger()}
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
