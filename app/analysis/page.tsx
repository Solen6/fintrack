import { TopNav } from "@/components/TopNav";
import { AnalysisClient } from "@/components/analysis/AnalysisClient";

export default function AnalysisPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <AnalysisClient />
    </div>
  );
}
