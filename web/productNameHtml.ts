import type { Plugin } from "vite";
import { PRODUCT_NAME } from "./src/productName.ts";

export const PRODUCT_NAME_PLACEHOLDER = "%PRODUCT_NAME%";

export function setProductName(html: string): string {
  return html.replaceAll(PRODUCT_NAME_PLACEHOLDER, PRODUCT_NAME);
}

export function productNameHtml(): Plugin {
  return { name: "product-name-html", transformIndexHtml: setProductName };
}
