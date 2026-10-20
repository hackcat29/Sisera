import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.SISERA_NEXT_DIST_DIR || ".next",
  transpilePackages: ["@sisera/domain", "@sisera/ui"],
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  async redirects() {
    return [{ source: "/social", destination: "/intelligence", permanent: true }];
  },
};

export default nextConfig;
