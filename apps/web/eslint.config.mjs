import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This project's pages intentionally fetch-on-mount in a plain useEffect (no SWR/React
      // Query): "let cancelled = false; setLoading(true); api.get(...).then(setX).finally(...)".
      // That pattern is exactly what this rule flags. At this app's scale (small-business
      // dashboards, a handful of requests per page) that tradeoff is fine; adopting a data-fetching
      // library to satisfy the rule is out of scope here.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
