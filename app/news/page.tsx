export const dynamic = "force-dynamic";

import { TopNav } from "@/components/TopNav";
import { NewsPageClient } from "@/components/news/NewsPageClient";

export default function NewsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <NewsPageClient />
    </div>
  );
}
