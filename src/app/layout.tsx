import type { Metadata } from "next";
import { DM_Mono, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "./nav-links";
import { RootLabel } from "./root-label";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Visualiser et organiser les projets de la machine",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${schibsted.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="flex min-h-14 flex-wrap items-center gap-x-6 border-b border-ink px-4">
          <div className="flex items-baseline gap-2.5">
            <Link href="/" className="text-[15px] font-bold tracking-tight">
              Project Manager
            </Link>
            <Suspense>
              <RootLabel />
            </Suspense>
          </div>
          <Suspense>
            <NavLinks />
          </Suspense>
        </header>
        {children}
      </body>
    </html>
  );
}
