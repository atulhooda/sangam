import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Hedera SDK (gRPC) and the 0G SDK need plain Node.js require, not bundling.
  serverExternalPackages: ["@hiero-ledger/sdk", "@0gfoundation/0g-compute-ts-sdk"],
};

export default nextConfig;
