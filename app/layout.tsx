import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Vision Kitchen · Scotty’s on King",
  description:
    "Private, offline-capable kitchen records, recipe costing and invoice review.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/vision-icon.svg", apple: "/vision-icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#182e2b",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
