import { TopNav } from "@/components/TopNav";
import { PaperClient } from "@/components/paper/PaperClient";

export default async function PaperPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  // `?account=<id>` lets a competition route open the Paper UI scoped to that
  // competition's sandbox account.
  const { account } = await searchParams;
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <PaperClient initialAccountId={account ?? null} />
    </div>
  );
}
