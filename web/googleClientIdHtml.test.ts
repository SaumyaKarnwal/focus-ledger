// @vitest-environment node
import { expect, test } from "vitest";
import { setGoogleClientId } from "./googleClientIdHtml";

test("setGoogleClientId_fillsTheEmptyTag", () => {
  const html = '<head><meta name="google-client-id" content="" /></head>';

  expect(setGoogleClientId(html, "id-1.apps.googleusercontent.com")).toBe(
    '<head><meta name="google-client-id" content="id-1.apps.googleusercontent.com" /></head>',
  );
});

test("setGoogleClientId_escapesTheValue", () => {
  const html = '<meta name="google-client-id" content="" />';

  expect(setGoogleClientId(html, 'a"><b')).toBe(
    '<meta name="google-client-id" content="a&quot;&gt;&lt;b" />',
  );
});
