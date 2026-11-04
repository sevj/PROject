import type { Metadata } from "next";
import { DM_Mono, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { DEFAULT_LOCALE } from "@/i18n";
import { DumpActivityProvider } from "./dump-activity";
import { FlashProvider } from "./flash";
import { LocaleBoundary } from "./locale-boundary";
import { NavLinks } from "./nav-links";
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
  description: "See and organize the projects on this machine",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={DEFAULT_LOCALE} className={`${schibsted.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Suspense>
          <LocaleBoundary>
            <FlashProvider>
              <DumpActivityProvider>
              <header className="site-header flex min-h-12 flex-wrap items-center gap-x-5 px-4">
                <Link href="/" className="inline-flex items-center gap-2 text-[14px] font-bold tracking-tight text-accent">
                  Project Manager
                  <span aria-hidden="true" className="size-1.5 bg-ink" />
                </Link>
                <Suspense>
                  <NavLinks />
                </Suspense>
              </header>
              {children}
              </DumpActivityProvider>
            </FlashProvider>
          </LocaleBoundary>
        </Suspense>
      </body>
    </html>
  );
}
