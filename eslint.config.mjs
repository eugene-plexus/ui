import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // `out/**` and the staged copy of it under `python/**` are build
    // OUTPUT: minified bundles that lint as thousands of violations.
    // They did not exist before the static export, and CI never saw
    // them because it lints before it builds — so this footgun fires
    // only on a developer's machine, after the first `npm run build`,
    // which is the worst place to discover it.
    ignores: ["src/generated/**", ".next/**", "node_modules/**", "out/**", "python/**", "dist/**"],
  },
];

export default eslintConfig;
