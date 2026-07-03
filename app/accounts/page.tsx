import { TopNav } from "@/components/TopNav";
import { PortfolioClient } from "@/components/portfolio/PortfolioClient";

export default function AccountsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <PortfolioClient />
      </div>
    </div>
  );
}
