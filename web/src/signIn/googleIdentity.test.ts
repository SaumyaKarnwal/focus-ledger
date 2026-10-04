import { afterEach, expect, test, vi } from "vitest";
import { renderGoogleButton } from "./googleIdentity";

afterEach(() => {
  delete window.google;
});

test("renderGoogleButton_drawsThePillContinueButton", async () => {
  const renderButton = vi.fn();
  window.google = {
    accounts: { id: { initialize: vi.fn(), renderButton } },
  };
  const parent = document.createElement("div");

  await renderGoogleButton(parent, "test-client-id", () => {});

  expect(renderButton).toHaveBeenCalledWith(
    parent,
    expect.objectContaining({ shape: "pill", text: "continue_with" }),
  );
});
