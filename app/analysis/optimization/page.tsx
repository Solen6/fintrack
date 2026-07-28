import { TopNav } from "@/components/TopNav";
import { OptimizationTool } from "@/components/analysis/tools/OptimizationTool";

export default function OptimizationPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <OptimizationTool />
    </div>
  );
}
