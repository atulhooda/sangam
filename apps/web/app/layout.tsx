import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT, ThemeToggle } from "./components/theme-toggle";
import { Geist, Geist_Mono } from "next/font/google";
import { SpaceBackdrop } from "./components/space/kit";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const DESCRIPTION =
  "Agents pay in USDC. Merchants get rupees. The settlement rail for the agent economy: x402 on Hedera, decided by 0G, paid out over UPI.";

export const metadata: Metadata = {
  // Absolute base for the social-card URLs. Set NEXT_PUBLIC_SITE_URL when deployed.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:5173"),
  title: { default: "Sangam", template: "%s" },
  description: DESCRIPTION,
  applicationName: "Sangam",
  openGraph: {
    type: "website",
    siteName: "Sangam",
    title: "Sangam: agents pay in USDC, merchants get rupees",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sangam: agents pay in USDC, merchants get rupees",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = { themeColor: "#05060d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script may switch .dark before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SpaceBackdrop />
        {/* first Tab stop on every page: jump past the nav */}
        <a
          href="#main"
          className="sr-only rounded-lg bg-accent px-4 py-2 font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] dark:text-[#0b0d1a]"
        >
          Skip to content
        </a>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
