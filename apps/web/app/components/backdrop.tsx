/**
 * Decorative page background, sits behind everything on the home page.
 * - hero: a faint grid plus the "two rivers" motif: a blue (USDC) and a green (₹)
 *   stream that meet under the headline and continue as one orange stream
 * - lower page: soft colour glows in the same three colours
 * Purely visual: aria-hidden, no pointer events.
 */

const STRANDS = [0, 14, 28];

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* hero grid, faded out with a radial mask */}
      <div className="hero-grid absolute inset-x-0 top-0 h-[1000px]" />

      {/* the two rivers: hug the sides, sweep in below the hero badges, meet, fade */}
      <svg
        className="absolute left-1/2 top-0 hidden h-[1000px] w-[1600px] -translate-x-1/2 md:block"
        viewBox="0 0 1600 1000"
        fill="none"
      >
        <defs>
          <linearGradient id="river-usdc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-info)" stopOpacity="0" />
            <stop offset="40%" stopColor="var(--color-info)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.65" />
          </linearGradient>
          <linearGradient id="river-inr" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ok)" stopOpacity="0" />
            <stop offset="40%" stopColor="var(--color-ok)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.65" />
          </linearGradient>
          <linearGradient id="river-merged" gradientUnits="userSpaceOnUse" x1="0" y1="700" x2="0" y2="745">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.65" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {STRANDS.map((o, i) => (
          <g key={o} strokeWidth={i === 0 ? 1.5 : 1} opacity={1 - i * 0.3}>
            <path d={`M -40 ${130 + o} C ${220 + o} ${150 + o}, ${240 + o} ${640 - o * 0.3}, ${800 - o * 0.25} 700`} stroke="url(#river-usdc)" />
            <path d={`M 1640 ${130 + o} C ${1380 - o} ${150 + o}, ${1360 - o} ${640 - o * 0.3}, ${800 + o * 0.25} 700`} stroke="url(#river-inr)" />
            <path d={`M ${800 + (o - 14) * 0.25} 700 L ${800 + (o - 14) * 0.25} 745`} stroke="url(#river-merged)" />
          </g>
        ))}
      </svg>

      {/* soft glows down the page */}
      <div className="absolute left-1/2 top-[-200px] h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div className="absolute left-[-220px] top-[950px] h-[500px] w-[500px] rounded-full bg-info/10 blur-3xl" />
      <div className="absolute right-[-220px] top-[1150px] h-[480px] w-[480px] rounded-full bg-ok/10 blur-3xl" />
      <div className="absolute left-[-150px] top-[4300px] h-[500px] w-[500px] rounded-full bg-accent/10 blur-3xl" />
      <div className="absolute right-[-150px] top-[4800px] h-[450px] w-[450px] rounded-full bg-warn/10 blur-3xl" />
    </div>
  );
}
