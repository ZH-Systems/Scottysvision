import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/kitchen.html", destination: "/", permanent: false }];
  },
};
export default config;
