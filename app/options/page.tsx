import { TopNav } from "@/components/TopNav";
import { OptionsClient } from "@/components/options/OptionsClient";

export default function OptionsPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <OptionsClient />
      </div>
    </div>
  );
}
