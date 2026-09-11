/**
 * Browser acceptance — the instrument vitest is not.
 *
 * M9's case for it, from the design: differentiator #5 (networked-first
 * with auth) is built and proven process-to-process, and **no browser has
 * ever driven any of it**. jsdom has no layout, no navigation, no real
 * fetch and no cookie jar, so it cannot be wrong about any of them; the
 * four wizard bugs Troy found on 2026-09-10 were all found by hand and
 * zero by tests.
 *
 * Three deliberate choices:
 *
 * **The system Chrome** (`channel: "chrome"`), so a dev box and CI need
 * no 300 MB download and no browser-version pin. Windows has Chrome or
 * Edge; Linux CI installs one package.
 *
 * **Pointed at an already-running install.** `webServer` is deliberately
 * absent: the fleet these tests drive is six processes started by
 * `scripts/m9-acceptance.sh`, not a `next dev` this config could spawn.
 * `EP_UI_URL` says where it is.
 *
 * **Opt-in, like every other acceptance run.** CI still runs vitest;
 * nothing here executes on a push. `npm run test:e2e` is the entry point
 * and the acceptance script is the caller that matters.
 *
 * Scope guard: Playwright is for the *arc* — first run, login,
 * restart-on-login, one completion. Anything assertable in jsdom stays in
 * vitest, which is faster and already in CI.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.EP_UI_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  // One worker, and no retries. These tests mutate one real install in
  // one order — a first run happens once — so parallelism would not be a
  // speedup, it would be two tests initializing the same install. And a
  // retry would re-run a step whose precondition the first attempt has
  // already consumed, turning one honest failure into a confusing one.
  workers: 1,
  retries: 0,
  fullyParallel: false,
  // Restart-on-login respawns every supervised child. The arc waits for
  // a fleet to come back, which is slower than any UI interaction.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    headless: process.env.EP_HEADED !== "1",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
