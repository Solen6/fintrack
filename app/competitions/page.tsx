import { Suspense } from "react";
import { TopNav } from "@/components/TopNav";
import { CompetitionsClient } from "@/components/competitions/CompetitionsClient";

export default function CompetitionsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      {/* CompetitionsClient reads ?id from the URL via useSearchParams → needs Suspense. */}
      <Suspense fallback={null}>
        <CompetitionsClient />
      </Suspense>
    </div>
  );
}
