// Dev only: create simulated payments (no money moves) so you can watch the
// dashboard without Hedera accounts. Needs `npm run web` running.
//   npm run simulate -- [count] [--short]
import { envOr } from "@sangam/shared";

const count = Number(process.argv[2] ?? 1);
const short = process.argv.includes("--short"); // underpay by 10% to exercise the "hold" path
const base = envOr("SANGAM_API_URL", "http://localhost:5173");

for (let i = 0; i < count; i++) {
  const res = await fetch(`${base}/api/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ short }),
  });
  const body = (await res.json()) as { id?: string; error?: string };
  console.log(res.ok ? `simulated settlement ${body.id}` : `failed (${res.status}): ${body.error}`);
}
