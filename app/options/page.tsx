import { TopNav } from "@/components/TopNav";
import { OptionsClient } from "@/components/options/OptionsClient";

export default function OptionsPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <OptionsClient />
      </div>
    </div>
  );
}
