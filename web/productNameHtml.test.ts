// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { PRODUCT_NAME_PLACEHOLDER, setProductName } from "./productNameHtml.ts";
import { PRODUCT_NAME } from "./src/productName.ts";

const indexHtml = readFileSync(new URL("index.html", import.meta.url), "utf8");

test("indexHtml_title_usesPlaceholderNotName", () => {
  expect(indexHtml).toContain(`<title>${PRODUCT_NAME_PLACEHOLDER}</title>`);
  expect(indexHtml).not.toContain(PRODUCT_NAME);
});

test("setProductName_indexHtml_setsTitleFromConstant", () => {
  expect(setProductName(indexHtml)).toContain(`<title>${PRODUCT_NAME}</title>`);
});
