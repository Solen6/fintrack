import { Suspense } from "react";
import { TopNav } from "@/components/TopNav";
import { AccountsPageClient } from "@/components/accounts/AccountsPageClient";

export default function AccountsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <Suspense fallback={<div className="flex-1" />}>
        <AccountsPageClient />
      </Suspense>
    </div>
  );
}
