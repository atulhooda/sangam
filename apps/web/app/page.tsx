import { TwoWorlds } from "./components/two-worlds";
import { FiveSteps } from "./components/five-steps";
import { FourDepartments } from "./components/four-departments";
import { CardsHero, CTABand, Footer, Hero, LayerStack, Nav } from "./components/space/landing";
import { NavyGlow } from "./components/space/kit";

export default function Home() {
  return (
    <main className="relative isolate bg-bg text-ink">
      <Nav />
      <Hero />
      <CardsHero />

      {/* The gap: two worlds that can't pay each other */}
      <div id="gap" className="relative scroll-mt-20">
        <NavyGlow className="-z-10 opacity-70" />
        <TwoWorlds />
      </div>

      {/* How one payment moves, step by step */}
      <div className="scroll-mt-20">
        <FiveSteps />
      </div>

      {/* The rail as an exploded 3D stack */}
      <LayerStack />

      {/* What Sangam is: the four departments */}
      <div className="relative scroll-mt-20">
        <NavyGlow className="-z-10 opacity-60" />
        <FourDepartments />
      </div>

      <CTABand />
      <Footer />
    </main>
  );
}
