import { TopNav } from "@/components/TopNav";
import { CorrelationTool } from "@/components/analysis/tools/CorrelationTool";

export default function CorrelationPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <CorrelationTool />
    </div>
  );
}
