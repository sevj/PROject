import type { Metadata } from "next";
import { DM_Mono, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { DEFAULT_LOCALE } from "@/i18n";
import { Logo, Wordmark } from "./brand";
import { ClaudeConsolesProvider } from "./claude-consoles";
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
  title: "PROject",
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
                <Link href="/" aria-label="PROject" className="inline-flex items-center gap-2 text-[15px]">
                  <Logo />
                  <Wordmark />
                </Link>
                <Suspense>
                  <NavLinks />
                </Suspense>
              </header>
              <ClaudeConsolesProvider>{children}</ClaudeConsolesProvider>
              </DumpActivityProvider>
            </FlashProvider>
          </LocaleBoundary>
        </Suspense>
      </body>
    </html>
  );
}
