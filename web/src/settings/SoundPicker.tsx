import { useEffect, useId, useRef, useState } from "react";

export type SoundOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** The id of the row label that names the picker. */
  labelId: string;
  options: readonly SoundOption<T>[];
  value: T;
  /** Runs for every pick, the current option included, so a pick can play its sound. */
  onPick: (value: T) => void;
};

/**
 * A narrow listbox button (README rule 12). A native select cannot pick the
 * current option again, and here a pick of the current option replays it.
 */
export function SoundPicker<T extends string>({
  labelId,
  options,
  value,
  onPick,
}: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((option) => option.value === value);

  const openList = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (index: number) => {
    onPick(options[index].value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div className="sound-picker" ref={root}>
      <button
        ref={button}
        type="button"
        className="sound-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${id}-value`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span id={`${id}-value`}>{current?.label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          className="sound-picker-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(options.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pick(active);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active || undefined}
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
