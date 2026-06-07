export const dynamic = "force-dynamic";

import { TopNav } from "@/components/TopNav";
import { BudgetPageClient } from "@/components/budget/BudgetPageClient";

export default function BudgetPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <BudgetPageClient />
    </div>
  );
}
