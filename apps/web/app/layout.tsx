import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Applies the stored theme (or the OS preference on first visit) before
  // first paint, so dark mode never flashes light.
  const themeScript = `(function(){try{var t=localStorage.getItem("sangam-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* first Tab stop on every page: jump past the nav */}
        <a
          href="#main"
          className="sr-only rounded-lg bg-accent px-4 py-2 font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] dark:text-[#1a1917]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
