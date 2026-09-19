import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One `.env` at the repo root feeds every workspace (see .env.example); Next only reads the app
// directory by default.
// `forceReload` is required: Next has already loaded the app directory's env by the time this
// runs, and `loadEnvConfig` returns that cached result unless it is told to reload.
loadEnvConfig(resolve(import.meta.dirname, "../.."), process.env.NODE_ENV !== "production", console, true);

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
