/**
 * The auth arc, in a browser, for the first time.
 *
 * Five steps, and a browser is the only client that exercises them in the
 * order a user does. From M9's design:
 *
 * | Step | Never browser-driven because |
 * |---|---|
 * | First run | every acceptance script calls it with `curl` |
 * | Login | the token is read from a shell variable in every test |
 * | Restart-on-login | scripts sleep; a browser has to *survive* it |
 * | Topology-resolved proxy | bypassed everywhere except M3 |
 * | Auto-unlock | tested headlessly in the agent's own suite |
 *
 * **The third row is the one that matters and the one a script cannot
 * test.** Logging in restarts every child — it is in the memory as a trap
 * because it surprised us once already. From a browser that means the
 * page which just authenticated is talking to a fleet that is going away
 * and coming back, and whether it recovers, spins, or shows a wall of
 * errors is a property nothing had ever observed.
 *
 * Runs against a live install started by `scripts/m9-acceptance.sh` —
 * **which does not pre-write `firstRunComplete`**, so the wizard here is
 * the wizard an operator meets. Every multi-host script since M0 wrote
 * that flag before starting anything, which is how the first-run path
 * went four milestones without a test.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const MODEL_ROOT = process.env.EP_MODEL_ROOT ?? "";

// Serial: these steps are one arc against one real install, and a first
// run happens once. Running them independently would mean the second test
// initializing an install the first already did.
test.describe.configure({ mode: "serial" });

test.describe("the auth arc", () => {
  test("first run: the wizard sets up an install nobody has set up", async ({ page }) => {
    await page.goto("/setup");

    // Screen 1 — look & feel. Nothing required.
    await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
    await page.getByRole("button", { name: /Continue/ }).click();

    // Screen 2 — the passphrase. Continue must stay disabled until both
    // halves match, which is the one rule on this screen.
    const fields = page.locator('input[type="password"]');
    await expect(fields).toHaveCount(2);
    await fields.nth(0).fill(PASSPHRASE);
    await fields.nth(1).fill(PASSPHRASE + "-typo");
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
    await fields.nth(1).fill(PASSPHRASE);
    await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
    await page.getByRole("button", { name: /Continue/ }).click();

    // Screens 3-5 — welcome, deployment, gateway. All defaults.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /Continue/ }).click();
    }

    // Screen 6 — model directories, if the harness gave us one.
    if (MODEL_ROOT) {
      await page
        .getByPlaceholder(/models/i)
        .first()
        .fill(MODEL_ROOT);
    }
    await page.getByRole("button", { name: /Continue/ }).click();

    // Screen 7 — backend. Skipped: the acceptance run declares its own,
    // and a wizard-created one would be a second path to the same state.
    await page.getByRole("button", { name: /Continue/ }).click();

    // Screen 8 — Start. This is the transaction: passphrase on the agent,
    // topology check, passphrase on the trust root, model directories,
    // firstRunComplete.
    await page.getByRole("button", { name: /^Start$/ }).click();

    // **And this is the part no script could test.** Initializing makes
    // the master key available, so the agent respawns every supervised
    // child; the page that just authenticated is talking to a fleet that
    // is going away. It has to land on the playground, not on an error.
    await expect(page).toHaveURL(/\/$|\/#/, { timeout: 120_000 });
    await expectNoWallOfErrors(page);
  });

  test("the install is set up now, so /setup is not where a visit lands", async ({ page }) => {
    // The client-side first-run redirect, asserted from a browser rather
    // than from the config flag — which is all the dev-seed run could do.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/setup/);
  });

  test("login: a fresh tab has no session and is sent to unlock", async ({ page }) => {
    // A real cookie jar and a real sessionStorage, which is the whole
    // point of doing this in a browser: the token lives in sessionStorage
    // and a new context genuinely does not have it.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Unlock/i })).toBeVisible();

    await page.locator("#passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: /Unlock/i }).click();

    await expect(page).toHaveURL(/\/$|\/#/, { timeout: 120_000 });
    await expectNoWallOfErrors(page);
  });

  test("the topology-resolved proxy works from a browser with a real session", async ({ page }) => {
    // Every page but the playground reaches its component through the
    // agent's bearer-protected `/v1/components`. `skipAuth` breaking that
    // is already recorded as a trap that was wrong on first instinct —
    // this is the check that would have caught it.
    await signIn(page);

    await page.goto("/runtimes");
    await expectNoWallOfErrors(page);

    await page.goto("/nodes");
    // The control root is reached through the same resolution, and an
    // uninitialized one 503s its whole surface by design. Seeing the
    // install's own node here means the wizard really initialized it.
    await expect(page.getByRole("heading", { name: "Nodes" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible({ timeout: 60_000 });
  });

  test("a completion goes through the playground", async ({ page }) => {
    test.skip(!process.env.EP_CHAT_MODEL, "no EP_CHAT_MODEL; nothing is serving");
    await signIn(page);
    await page.goto("/");

    const input = page.locator("textarea").first();
    await input.fill("Reply with the single word: ok");
    await input.press("Enter");

    // The gateway's own envelope is rendered in the routing bar, so an
    // answer that arrives without one is an answer that did not come
    // through the control plane.
    await expect(page.locator("text=/tier|driver|ms/i").first()).toBeVisible({
      timeout: 150_000,
    });
    await expectNoWallOfErrors(page);
  });
});

/** Sign in through the real form, because that is the code path a user
 * takes. Seeding sessionStorage directly would test the token, not the
 * login. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  if (
    await page
      .locator("#passphrase")
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator("#passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: /Unlock/i }).click();
    await expect(page).toHaveURL(/\/$|\/#/, { timeout: 120_000 });
  }
}

/**
 * The assertion the restart-on-login question actually needs.
 *
 * "Did it navigate" is not the same as "did it work": a page can land on
 * the playground and render every panel as a failed fetch, because the
 * fleet it is talking to is mid-respawn. So look for the symptom rather
 * than the destination.
 */
async function expectNoWallOfErrors(page: Page): Promise<void> {
  const errors = page.locator(".status-error");
  const count = await errors.count();
  if (count === 0) return;
  const texts = await errors.allTextContents();
  expect(texts.join(" | "), "the page rendered errors after an auth transition").toBe("");
}
