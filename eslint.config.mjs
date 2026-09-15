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
    // Third-party bundles we ship but do not author. public/pdf.worker.min.mjs
    // alone produced ~1,550 of the 1,611 warnings in this repo, which buried
    // every real finding in the app code.
    "public/**",
    "dist/**",
    "vendor/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // These screens seed state from useSearchParams() inside an effect. The
    // rule is right that it causes an extra render and a stale first frame,
    // but converting them is eight individually-reasoned changes across the
    // whole teacher workflow and wants a browser to verify against. Kept
    // visible as a warning rather than silenced, and written up with the
    // exact transformation per site in docs/url-derived-state.md. Move each
    // file back to the default `error` as it is converted.
    files: [
      "app/login/page.tsx",
      "components/teacher-answer-key.tsx",
      "components/teacher-assessments.tsx",
      "components/teacher-insights.tsx",
      "components/teacher-planning.tsx",
      "components/teacher-review.tsx",
      "components/teacher-scan.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
