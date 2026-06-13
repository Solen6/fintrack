import { TopNav } from "@/components/TopNav";
import { PaperClient } from "@/components/paper/PaperClient";

export default function PaperPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <PaperClient />
    </div>
  );
}
