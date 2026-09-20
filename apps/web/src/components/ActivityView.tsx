"use client";

import { Panel, Tabs } from "@orionis/ui";
import { useState } from "react";
import { useAccount } from "wagmi";
import { FundingTable, HistoryTable } from "./ActivityTables";

type Tab = "history" | "funding";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "history", label: "Transactions" },
  { id: "funding", label: "Funding" },
];

/// PROJECT_BRIEF.md Section 22: the wallet's full record. Both tables come from the indexer, and
/// the Portfolio page shows the same ones next to the positions they belong to.
export function ActivityView() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("history");

  if (!isConnected) {
    return (
      <Panel title="Activity">
        <p className="p-3 text-muted">Connect a wallet to see its transactions and funding payments.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={<Tabs label="Activity sections" tabs={tabs} value={tab} onChange={setTab} />}
    >
      <div role="tabpanel" className="overflow-x-auto">
        {tab === "history" ? <HistoryTable /> : <FundingTable />}
      </div>
    </Panel>
  );
}
