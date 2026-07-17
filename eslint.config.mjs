import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway CJS emitted by the scripts/test-*.mjs harnesses. Already
    // gitignored; ignored here too because a test that fails leaves its build
    // dir behind, and linting generated CJS would then fail the lint gate for a
    // reason that has nothing to do with the source.
    ".test-build-*/**",
  ]),
]);

export default eslintConfig;
