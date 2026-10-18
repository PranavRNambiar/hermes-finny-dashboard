import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { AppShell } from "@/components/app";
import "./globals.css";

// Rounded type to match the iOS app's SF Pro Rounded (Safari uses ui-rounded natively).
const rounded = Nunito({ subsets: ["latin"], variable: "--font-rounded", weight: ["400", "500", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "Finny",
  description: "Know where every dollar went.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finny" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F0F1F5" }, { media: "(prefers-color-scheme: dark)", color: "#0B0F14" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={rounded.variable}>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
