import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ledgerClient } from "./api/ledgerClient";
import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={ledgerClient()} />
  </StrictMode>,
);
