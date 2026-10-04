import type { ReactNode } from "react";
import { PRODUCT_NAME } from "../productName";

type Props = {
  /** A bar with a surface and a bottom line, as on Today and the Tree. */
  framed?: boolean;
  middle?: ReactNode;
  end?: ReactNode;
  /** Makes the wordmark a link home. */
  onOpenHome?: () => void;
  homeLabel?: string;
};

export function PageHeader({
  framed = false,
  middle,
  end,
  onOpenHome,
  homeLabel = "back to Start",
}: Props) {
  return (
    <header className={framed ? "topbar" : "topbar topbar-plain"}>
      <h1 className="brand">
        {onOpenHome ? (
          <button
            type="button"
            className="screen-home"
            aria-label={`${PRODUCT_NAME}, ${homeLabel}`}
            onClick={onOpenHome}
          >
            {PRODUCT_NAME}
          </button>
        ) : (
          PRODUCT_NAME
        )}
      </h1>
      {middle ?? <span />}
      {end ?? <span />}
    </header>
  );
}
