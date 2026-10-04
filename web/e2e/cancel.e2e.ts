import { expect, test } from "@playwright/test";

// Issue 221: every Cancel is the text button from board A-Signout.
test("the Sign out Cancel is a 40px text button with a hover plate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?backend=fake&fixture=today");
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const cancel = page
    .getByRole("alertdialog", { name: "Sign out?" })
    .getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();

  const style = () =>
    cancel.evaluate((element) => {
      const computed = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = "var(--ink-muted)";
      probe.style.background = "var(--control-hover)";
      document.body.append(probe);
      const tokens = getComputedStyle(probe);
      const result = {
        height: computed.height,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
        borderWidth: computed.borderTopWidth,
        background: computed.backgroundColor,
        color: computed.color,
        mutedInk: tokens.color,
        hoverPlate: tokens.backgroundColor,
        outline: computed.outlineStyle,
      };
      probe.remove();
      return result;
    });

  const atRest = await style();
  expect(atRest).toMatchObject({
    height: "40px",
    paddingLeft: "16px",
    paddingRight: "16px",
    borderWidth: "0px",
    background: "rgba(0, 0, 0, 0)",
    color: atRest.mutedInk,
  });

  await cancel.hover();
  const hovered = await style();
  expect(hovered.background).toBe(hovered.hoverPlate);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  expect((await style()).outline).toBe("solid");
});
