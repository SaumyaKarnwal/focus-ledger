import { expect, type Page, test } from "@playwright/test";

// README "Addresses": each page has an address that survives a reload.

async function open(page: Page, path: string) {
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${path}?backend=fake&fixture=today`);
}

test("a task address survives a reload, and Back and Forward work", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: "Tasks" })
    .click();
  await page.getByRole("listitem", { name: "Book", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit task, Book" }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/tasks\/[0-9a-f-]+$/);
  expect(new URL(page.url()).search).toBe("?backend=fake&fixture=today");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit task, Book" }),
  ).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
});

test("a wrong address goes home", async ({ page }) => {
  await open(page, "/nowhere");

  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});
