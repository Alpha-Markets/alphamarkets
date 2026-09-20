import { Header } from "@/components/Header";
import { StrategyBuilder } from "@/components/StrategyBuilder";
import { TxToasts } from "@/components/TxToasts";
import { env } from "@/lib/env";

/// PROJECT_BRIEF.md Section 41: the options strategy builder.
export default function Strategies() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header current="Strategies" />
      {env.rpcConfigured ? null : (
        <p role="alert" className="border-b border-line bg-raised px-4 py-2 text-down">
          NEXT_PUBLIC_RPC_URL is not set, so no market data can load. Add it to .env and restart.
        </p>
      )}
      <main className="flex-1">
        <StrategyBuilder />
      </main>
      <TxToasts />
    </div>
  );
}
