import { redirect } from "next/navigation";

// The root path is not a page of its own. Unauthenticated visitors are sent to
// /login by the proxy before they get here, so anyone reaching this point is
// signed in and belongs on the dashboard.
export default function Home() {
  redirect("/dashboard");
}
