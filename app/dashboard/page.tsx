import { TopNav } from "@/components/TopNav";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <DashboardClient />
    </div>
  );
}
