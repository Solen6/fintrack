import { TopNav } from "@/components/TopNav";
import { FuturesHeatmap } from "@/components/futures/FuturesHeatmap";

export default function FuturesPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <FuturesHeatmap />
      </div>
    </div>
  );
}
