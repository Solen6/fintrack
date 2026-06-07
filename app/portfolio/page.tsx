import { TopNav } from "@/components/TopNav";
import { PortfolioClient } from "@/components/portfolio/PortfolioClient";

export default function PortfolioPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <PortfolioClient />
      </div>
    </div>
  );
}
