"use client";

import { Button } from "@orionis/ui";
import { useTerminal } from "@/stores/terminal";

/// Phone-only shortcut to the order panel: picks the side and opens the sheet.
export function PerpTradeBar({ open }: { open: () => void }) {
  const setSide = useTerminal((state) => state.setSide);
  return (
    <>
      <Button
        variant="up"
        className="flex-1"
        onClick={() => {
          setSide("LONG");
          open();
        }}
      >
        Long
      </Button>
      <Button
        variant="down"
        className="flex-1"
        onClick={() => {
          setSide("SHORT");
          open();
        }}
      >
        Short
      </Button>
    </>
  );
}
