"use client";

import { Button } from "@orionis/ui";
import { expiryCode, strikeText } from "@/lib/options";
import { useOptionOrder } from "@/stores/optionOrder";
import { OptionTicket } from "./OptionTicket";
import { TradeSheet } from "./TradeSheet";

/// The option ticket, opened automatically on a phone when a series is picked in the chain.
export function OptionTradeSheet() {
  const selection = useOptionOrder((state) => state.selection);
  const key = selection ? `${selection.symbol}-${selection.expiry}-${selection.strike}-${selection.type}` : undefined;
  const label = selection
    ? `Buy ${selection.symbol} ${expiryCode(selection.expiry)} ${strikeText(selection.strike)} ${selection.type === "CALL" ? "call" : "put"}`
    : "Open order ticket";

  return (
    <TradeSheet
      title="Option order"
      openWhen={key}
      bar={(open) => (
        <Button variant="primary" className="flex-1" onClick={open}>
          {label}
        </Button>
      )}
    >
      <OptionTicket />
    </TradeSheet>
  );
}
