import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

// The सं app icon, embedded as-is (the card's default font has no Devanagari glyphs).
const ICON = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "app/icon.png")).toString("base64")}`;

export const alt = "Sangam: agents pay in USDC, merchants get rupees.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card (Slack, X, LinkedIn…), rendered at build time. */
export default function OpengraphImage() {
  const chip = (t: string) => (
    <div
      style={{
        display: "flex",
        padding: "8px 18px",
        borderRadius: 999,
        border: "2px solid #e3e2ea",
        background: "#ffffff",
        color: "#73727e",
        fontSize: 24,
      }}
    >
      {t}
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#f4f3f7",
          backgroundImage: "radial-gradient(circle at 85% 0%, rgba(109,74,255,0.16), transparent 55%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ICON} width={56} height={56} alt="" />
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#6d4aff" }}>sangam</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: "#16151d", letterSpacing: -2, lineHeight: 1.05 }}>
            Agents pay in&nbsp;<span style={{ color: "#6d4aff" }}>USDC</span>.
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: "#16151d", letterSpacing: -2, lineHeight: 1.05 }}>
            Merchants get&nbsp;<span style={{ color: "#6d4aff" }}>rupees</span>.
          </div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: "#73727e" }}>
            The settlement rail for the agent economy.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {chip("x402")}
          {chip("Hedera")}
          {chip("0G Compute")}
          {chip("ENSv2")}
          {chip("UPI")}
        </div>
      </div>
    ),
    size,
  );
}
