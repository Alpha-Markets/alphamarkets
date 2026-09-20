import { Header } from "@/components/Header";
import { OptionChain } from "@/components/OptionChain";
import { OptionPositions } from "@/components/OptionPositions";
import { OptionTicket } from "@/components/OptionTicket";
import { TxToasts } from "@/components/TxToasts";
import { env } from "@/lib/env";

/// PROJECT_BRIEF.md Sections 25-26, desktop-first: chain and open positions on the left, the
/// order ticket on the right. The underlying and expiry selectors live in the chain panel.
export default function OptionsTerminal() {
  return (
    <div className="flex h-screen flex-col">
      <Header current="Options" />
      {env.rpcConfigured ? null : (
        <p role="alert" className="border-b border-line bg-raised px-4 py-2 text-down">
          NEXT_PUBLIC_RPC_URL is not set, so no market data can load. Add it to .env and restart.
        </p>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-px bg-line">
        <div className="flex min-h-0 flex-col gap-px">
          <OptionChain />
          <OptionPositions />
        </div>
        <OptionTicket />
      </main>
      <TxToasts />
    </div>
  );
}
