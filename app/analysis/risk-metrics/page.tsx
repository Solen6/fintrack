import { TopNav } from "@/components/TopNav";
import { RiskMetricsTool } from "@/components/analysis/tools/RiskMetricsTool";

export default function RiskMetricsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <RiskMetricsTool />
    </div>
  );
}
