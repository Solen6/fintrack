import { TopNav } from "@/components/TopNav";
import { AttributionTool } from "@/components/analysis/tools/AttributionTool";

export default function AttributionPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <AttributionTool />
    </div>
  );
}
