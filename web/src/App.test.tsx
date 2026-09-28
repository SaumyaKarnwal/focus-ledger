import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";
import { PRODUCT_NAME } from "./productName";

test("App_render_showsProductName", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeDefined();
});

test("App_secondRender_startsFromCleanDocument", () => {
  render(<App />);

  expect(screen.getAllByRole("heading", { name: PRODUCT_NAME })).toHaveLength(
    1,
  );
});
