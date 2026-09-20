import { ActivityView } from "@/components/ActivityView";
import { Header } from "@/components/Header";
import { TxToasts } from "@/components/TxToasts";

export default function ActivityPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header current="Activity" />
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4">
        <ActivityView />
      </main>
      <TxToasts />
    </div>
  );
}
