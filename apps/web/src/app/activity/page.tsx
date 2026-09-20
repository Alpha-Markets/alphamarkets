import { ActivityView } from "@/components/ActivityView";
import { PageHeader } from "@/components/PageHeader";

export default function ActivityPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-10">
      <PageHeader title="Activity">Every transaction and funding payment for the connected wallet.</PageHeader>
      <ActivityView />
    </div>
  );
}
