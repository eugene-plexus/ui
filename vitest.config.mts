/**
 * Test runner for the UI.
 *
 * Added because four wizard defects in a row were found by a human running
 * the wizard and none by anything automated: the repo had no way to execute
 * a screen at all, so every change to `/setup` shipped unexercised.
 *
 * jsdom rather than a browser, and `global.fetch` mocked rather than a live
 * install: what these tests are for is the *sequence of calls* a screen makes
 * and the order it makes them in, which is where the wizard's defects have
 * actually lived. A browser-driven check of layout and a live acceptance run
 * are different instruments and neither is replaced here.
 */

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors tsconfig's `paths`. Hand-written rather than pulled from
      // tsconfig by a plugin so there is one less dependency to keep current;
      // there is exactly one alias and it has never changed.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // A wizard test drives eight screens and then a transaction that sleeps a
    // second between retries. The 5s default is not a budget these fit in, and
    // a test that times out mid-transaction leaves work running into the next
    // one - so the cost of the default being too tight is misattributed
    // failures, not just a slow suite.
    testTimeout: 30_000,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Generated clients are codegen output; they have no behaviour to test
    // and their freshness is asserted by CI's codegen-freshness job instead.
    exclude: ["src/generated/**", "node_modules/**", ".next/**"],
  },
});
