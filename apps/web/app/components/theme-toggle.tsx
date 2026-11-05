"use client";

/**
 * Light/dark toggle with a sun and a moon.
 * Which icon shows is pure CSS (html.dark), so it is correct on first paint
 * with no hydration flicker. The inline script in layout.tsx applies the
 * stored theme before paint; this button flips it and remembers the choice.
 */
export function ThemeToggle() {
  function toggle() {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("sangam-theme", dark ? "dark" : "light");
    } catch {
      // storage blocked: the toggle still works for this page view
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="group relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface text-ink transition-colors hover:border-accent hover:text-accent"
    >
      {/* Sun: shown in light mode */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="absolute h-[18px] w-[18px] rotate-0 scale-100 opacity-100 transition-all duration-500 dark:-rotate-90 dark:scale-0 dark:opacity-0"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      {/* Moon: shown in dark mode */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute h-[18px] w-[18px] rotate-90 scale-0 opacity-0 transition-all duration-500 dark:rotate-0 dark:scale-100 dark:opacity-100"
        aria-hidden
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
