import { TopNav } from "@/components/TopNav";
import { MonteCarloTool } from "@/components/analysis/tools/MonteCarloTool";

export default function MonteCarloPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <MonteCarloTool />
    </div>
  );
}
