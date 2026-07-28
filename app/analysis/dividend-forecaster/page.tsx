import { TopNav } from "@/components/TopNav";
import { DividendForecasterTool } from "@/components/analysis/tools/DividendForecasterTool";

export default function DividendForecasterPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <DividendForecasterTool />
    </div>
  );
}
