import type { ReactNode } from "react";
import { PRODUCT_NAME } from "../productName";

type Props = {
  /** A bar with a surface and a bottom line, as on Today and the Tree. */
  framed?: boolean;
  middle?: ReactNode;
  end?: ReactNode;
};

export function PageHeader({ framed = false, middle, end }: Props) {
  return (
    <header className={framed ? "topbar" : "topbar topbar-plain"}>
      <h1 className="brand">{PRODUCT_NAME}</h1>
      {middle ?? <span />}
      {end ?? <span />}
    </header>
  );
}
