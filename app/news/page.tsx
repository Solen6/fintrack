export const dynamic = "force-dynamic";

import { TopNav } from "@/components/TopNav";
import { NewsPageClient } from "@/components/news/NewsPageClient";

export default function NewsPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <NewsPageClient />
    </div>
  );
}
