import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "runtime/**",
    "out/**",
    "coverage/**",
    "data/**",
    "data-*/**",
    "test-results/**",
    "backups/**",
    ".private-secrets/**",
    ".agents/**",
    ".codex/**",
    "next-env.d.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Existing SQLite/JSON DTOs are still dynamic; strict tsc and runtime
      // schemas stay mandatory. This task does not redesign every DTO type.
      "@typescript-eslint/no-explicit-any": "off",
      // Local storage/session hydration and request loading indicators are
      // intentional effect-driven state here. No React Compiler is enabled.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
