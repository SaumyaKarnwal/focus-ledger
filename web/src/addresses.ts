/** The pages that have their own address (README "Addresses"). */
export type View = "today" | "tree" | "report" | "settings";

export type Address = { view: View; taskId?: string };

export const HOME: Address = { view: "today" };

/** Reads a path. A wrong or old path gives undefined, and the caller goes home. */
export function parseAddress(pathname: string): Address | undefined {
  const parts = pathname.split("/").filter((part) => part !== "");
  if (parts.length === 0) return HOME;
  const [first, second, ...rest] = parts;
  if (rest.length > 0) return undefined;
  if (first === "tasks") {
    return second === undefined
      ? { view: "tree" }
      : { view: "tree", taskId: decodeURIComponent(second) };
  }
  if (second !== undefined) return undefined;
  if (first === "settings") return { view: "settings" };
  if (first === "report") return { view: "report" };
  return undefined;
}

export function pathOf(address: Address): string {
  switch (address.view) {
    case "today":
      return "/";
    case "tree":
      return address.taskId === undefined
        ? "/tasks"
        : `/tasks/${encodeURIComponent(address.taskId)}`;
    case "settings":
      return "/settings";
    case "report":
      return "/report";
  }
}
