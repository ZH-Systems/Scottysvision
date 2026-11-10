import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vision Kitchen • Scotty’s on King",
  description: "Private, offline-capable kitchen records, recipe costing and invoice review.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
