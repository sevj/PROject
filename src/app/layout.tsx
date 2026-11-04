import type { Metadata } from "next";
import { DM_Mono, Schibsted_Grotesk } from "next/font/google";
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
        <header className="flex h-14 items-baseline gap-2.5 border-b border-ink px-4 pt-4">
          <strong className="text-[15px] font-bold tracking-tight">Project Manager</strong>
          <span className="font-mono text-[12.5px] text-mut">~/Projects</span>
        </header>
        {children}
      </body>
    </html>
  );
}
