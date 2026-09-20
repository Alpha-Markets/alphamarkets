"use client";

import { Button } from "@alphamarkets/ui";
import { expiryCode, strikeText } from "@/lib/options";
import { useOptionOrder } from "@/stores/optionOrder";
import { OptionTicket } from "./OptionTicket";
import { TradeSheet, useOpenTradeSheet } from "./TradeSheet";

function OptionTradeBar() {
  const open = useOpenTradeSheet();
  const selection = useOptionOrder((state) => state.selection);
  const label = selection
    ? `Buy ${selection.symbol} ${expiryCode(selection.expiry)} ${strikeText(selection.strike)} ${selection.type === "CALL" ? "call" : "put"}`
    : "Open order ticket";
  return (
    <Button variant="primary" className="flex-1" onClick={open}>
      {label}
    </Button>
  );
}

/// The option ticket, opened automatically on a phone when a series is picked in the chain.
export function OptionTradeSheet() {
  const selection = useOptionOrder((state) => state.selection);
  const key = selection ? `${selection.symbol}-${selection.expiry}-${selection.strike}-${selection.type}` : undefined;
  return (
    <TradeSheet title="Option order" openWhen={key} bar={<OptionTradeBar />}>
      <OptionTicket />
    </TradeSheet>
  );
}
