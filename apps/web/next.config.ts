import type { NextConfig } from "next";

// The API now lives in this app (app/api/*), so there are no proxy rewrites
// to the old Express servers any more.
const nextConfig: NextConfig = {};

export default nextConfig;
