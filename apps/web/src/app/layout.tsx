import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Graphify Knowledge Agent",
    template: "%s · Graphify Knowledge Agent",
  },
  description:
    "Enterprise evidence-grounded research across connected knowledge and source documents.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={500} skipDelayDuration={250}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
