import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eugene Plexus",
  description: "Bicameral consciousness scaffold over LLMs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
