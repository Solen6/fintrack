import { TopNav } from "@/components/TopNav";
import { TaxLossHarvesterTool } from "@/components/analysis/tools/TaxLossHarvesterTool";

export default function TaxLossHarvesterPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <TaxLossHarvesterTool />
    </div>
  );
}
