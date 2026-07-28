import { TopNav } from "@/components/TopNav";
import { RebalancerTool } from "@/components/analysis/tools/RebalancerTool";

export default function RebalancerPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <RebalancerTool />
    </div>
  );
}
