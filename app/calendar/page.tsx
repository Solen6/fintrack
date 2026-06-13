import { TopNav } from "@/components/TopNav";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export default function CalendarPage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TopNav />
      <CalendarClient />
    </div>
  );
}
