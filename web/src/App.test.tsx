import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("App_render_showsTitle", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Focus Ledger" })).toBeDefined();
});

test("App_secondRender_startsFromCleanDocument", () => {
  render(<App />);

  expect(screen.getAllByRole("heading", { name: "Focus Ledger" })).toHaveLength(
    1,
  );
});
