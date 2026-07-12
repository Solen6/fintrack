import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
      <body className="min-h-full bg-background text-foreground">
        {/* Runs before hydration so private mode masks balances with no flash.
            next/script (not a raw <script>) avoids React 19's "script tag while
            rendering" warning. React-state masking in <Sensitive> is the primary
            mechanism; this class toggle is the first-paint guard. */}
        <Script id="fintrack-privacy-boot" strategy="beforeInteractive">
          {PRIVACY_BOOT}
        </Script>
        <PrivacyProvider>{children}</PrivacyProvider>
      </body>
    </html>
  );
}
