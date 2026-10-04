/// <reference lib="dom" />
import { expect, type Page, test } from "@playwright/test";

// README rule 11: the header links work on every Start state and on Break.

const states = ["Deep Focus", "Execution", "Shallow", "nothing", "Break"];

async function openState(page: Page, state: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  const fixture = state === "nothing" ? "empty" : "today";
  await page.goto(`/?backend=fake&fixture=${fixture}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  if (state === "Execution" || state === "Shallow") {
    await page.getByRole("radio", { name: state }).click();
  }
  if (state === "Break") {
    await page.getByRole("button", { name: "Take a break" }).click();
    await expect(
      page.getByRole("button", { name: "Start the break" }),
    ).toBeVisible();
  }
}

for (const width of [1280, 900]) {
  for (const state of states) {
    test(`${width}px, ${state}: Tasks and Settings open`, async ({ page }) => {
      const views = page.getByRole("navigation", { name: "Views" });

      await openState(page, state, width);
      await views.getByRole("button", { name: "Tasks" }).click();
      await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();

      await openState(page, state, width);
      await views.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Cycles" })).toBeVisible();
    });
  }
}
