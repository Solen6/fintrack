import { TopNav } from "@/components/TopNav";
import { FactorExposureTool } from "@/components/analysis/tools/FactorExposureTool";

export default function FactorExposurePage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <FactorExposureTool />
    </div>
  );
}
