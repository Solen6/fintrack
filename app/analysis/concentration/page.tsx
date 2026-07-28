import { TopNav } from "@/components/TopNav";
import { ConcentrationTool } from "@/components/analysis/tools/ConcentrationTool";

export default function ConcentrationPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <ConcentrationTool />
    </div>
  );
}
