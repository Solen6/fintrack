import { TopNav } from "@/components/TopNav";
import { BenchmarkLabTool } from "@/components/analysis/tools/BenchmarkLabTool";

export default function BenchmarkLabPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <BenchmarkLabTool />
    </div>
  );
}
