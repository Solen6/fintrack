import { TopNav } from "@/components/TopNav";
import { MarketClient } from "@/components/market/MarketClient";

export default function MarketPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <MarketClient />
    </div>
  );
}
