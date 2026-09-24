"use client";

import { Button, cn } from "@alphamarkets/ui";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const OpenSheet = createContext<() => void>(() => {});

/// Opens the surrounding `TradeSheet`. Buttons in its `bar` call this.
export const useOpenTradeSheet = () => useContext(OpenSheet);

/// The order panel on a wide screen; on a phone it becomes a full-height sheet opened from a bar
/// pinned to the bottom of the page. The same panel stays mounted in both, so what was typed is kept
/// when the sheet closes.
///
/// `bar` holds the buttons in the pinned bar; they open the sheet with `useOpenTradeSheet`. `openWhen` opens the sheet
/// whenever it changes to a truthy value (for example a series picked in the option chain).
export function TradeSheet({
  title,
  bar,
  openWhen,
  children,
}: {
  title: string;
  bar: ReactNode;
  openWhen?: unknown;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Only a change opens the sheet; a value left over from an earlier visit does not.
  const seen = useRef(openWhen);
  useEffect(() => {
    if (openWhen && openWhen !== seen.current) setOpen(true);
    seen.current = openWhen;
  }, [openWhen]);

  // Keep the page behind a phone sheet from scrolling under it.
  useEffect(() => {
    if (!open) return;
    const main = document.getElementById("main");
    if (!main) return;
    const previous = main.style.overflow;
    if (window.matchMedia("(max-width: 1023px)").matches) main.style.overflow = "hidden";
    return () => {
      main.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <div
        className={cn(
          "min-h-0 lg:block",
          // top offset: the header's own height (h-20, 5rem) plus the markets ticker above it (h-11, 2.75rem).
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[7.75rem] max-lg:z-30 max-lg:flex max-lg:flex-col max-lg:bg-surface",
          open ? "" : "max-lg:hidden",
        )}
        role={open ? "dialog" : undefined}
        aria-label={title}
      >
        <div className="flex h-11 shrink-0 items-center justify-end border-b border-line px-1 lg:hidden">
          <Button variant="secondary" size="sm" aria-label={`Close ${title.toLowerCase()}`} onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 lg:h-full">{children}</div>
      </div>
      <div className="sticky bottom-0 z-20 flex gap-2 border-t border-line bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
        <OpenSheet.Provider value={() => setOpen(true)}>{bar}</OpenSheet.Provider>
      </div>
    </>
  );
}
