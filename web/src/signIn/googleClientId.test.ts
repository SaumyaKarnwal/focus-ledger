import { expect, test } from "vitest";
import { readGoogleClientId } from "./googleClientId";

function page(head: string): Document {
  return new DOMParser().parseFromString(
    `<html><head>${head}</head></html>`,
    "text/html",
  );
}

test("readGoogleClientId_filledTag_returnsTheId", () => {
  const doc = page(
    '<meta name="google-client-id" content="id-1.apps.googleusercontent.com" />',
  );

  expect(readGoogleClientId(doc)).toBe("id-1.apps.googleusercontent.com");
});

test("readGoogleClientId_emptyTag_returnsUndefined", () => {
  const doc = page('<meta name="google-client-id" content="" />');

  expect(readGoogleClientId(doc)).toBeUndefined();
});

test("readGoogleClientId_noTag_returnsUndefined", () => {
  expect(readGoogleClientId(page(""))).toBeUndefined();
});
