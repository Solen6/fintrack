import { TopNav } from "@/components/TopNav";
import { StressTestTool } from "@/components/analysis/tools/StressTestTool";

export default function StressTestPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <StressTestTool />
    </div>
  );
}
