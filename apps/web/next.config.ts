import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One `.env` at the repo root feeds every workspace (see .env.example); Next only reads the app
// directory by default.
loadEnvConfig(resolve(import.meta.dirname, "../.."));

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@orionis/sdk", "@orionis/config", "@orionis/types", "@orionis/ui"],
  reactStrictMode: true,
  // Workspace packages import their own files as "./x.js" while the source is x.ts / x.tsx.
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
