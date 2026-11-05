
import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Sangam · Dashboard",
  description: "Live settlement desk: every agent payment, from USDC in to rupees out.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
