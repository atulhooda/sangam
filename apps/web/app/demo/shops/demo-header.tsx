import Link from "next/link";
import { Logo } from "../../components/space/kit";

export function DemoHeader({ title }: { title: string }) {
  return (
    <header className="space-bar sticky top-3 z-40">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="Sangam home"><Logo /></Link>
          <span className="text-line">/</span>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <nav className="flex shrink-0 items-center gap-2 text-sm">
          <Link href="/demo/shops" className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-muted transition-colors hover:text-ink sm:block">Side by side</Link>
          <Link href="/dashboard" className="rounded-full bg-white px-3.5 py-1.5 font-medium text-black">Settlement desk</Link>
        </nav>
      </div>
    </header>
  );
}
