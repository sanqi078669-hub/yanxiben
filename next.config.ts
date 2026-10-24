import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./data-*/**/*",
      "./test-results/**/*",
      "./backups/**/*",
      "./.private-secrets/**/*",
      "./.env*",
      "./**/*.key",
      "./**/*.pem",
      "./**/*.sqlite*",
      "./**/*.db",
      "./**/*.db-*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
