import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("App_render_showsTitle", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Ekagra" })).toBeDefined();
});

test("App_secondRender_startsFromCleanDocument", () => {
  render(<App />);

  expect(screen.getAllByRole("heading", { name: "Ekagra" })).toHaveLength(1);
});
