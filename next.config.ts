import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Names a local reverse proxy gives the app: the dev server answers its own assets to them.
  allowedDevOrigins: (process.env.PM_ALLOWED_HOSTS ?? "").split(",").map((name) => name.trim()).filter(Boolean),
  cacheComponents: true,
  // In development, Next would print the arguments of every Server Action, env values included.
  logging: { serverFunctions: false },
  partialPrefetching: true,
  // Loaded by Node as it is: its optional native parts must not be bundled.
  serverExternalPackages: ["ws", "node-pty"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
