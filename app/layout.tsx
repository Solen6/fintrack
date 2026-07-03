import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PrivacyProvider } from "@/lib/privacy";

/* Runs before first paint: if private mode was left on, mark <html> so the CSS
   masks balances immediately — no flash of real values on load. */
const PRIVACY_BOOT = `try{if(localStorage.getItem('fintrack:private')==='1')document.documentElement.classList.add('is-private')}catch(e){}`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fintrack",
  description: "Personal finance dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fintrack",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0c0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRIVACY_BOOT }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <PrivacyProvider>{children}</PrivacyProvider>
      </body>
    </html>
  );
}
