import { TopNav } from "@/components/TopNav";
import { FuturesHeatmap } from "@/components/futures/FuturesHeatmap";

export default function FuturesPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <FuturesHeatmap />
      </div>
    </div>
  );
}
