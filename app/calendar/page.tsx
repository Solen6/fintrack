import { TopNav } from "@/components/TopNav";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export default function CalendarPage() {
  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <TopNav />
      <CalendarClient />
    </div>
  );
}
