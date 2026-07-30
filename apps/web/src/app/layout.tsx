import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Graphify Knowledge Agent",
  description: "Evidence-grounded answers from a Graphify knowledge graph",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
