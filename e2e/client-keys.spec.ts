/**
 * "Use it from your apps": the card, a real key, and a real request (S4).
 *
 * Runs against the live install `scripts/client-keys-acceptance.sh`
 * stands up — a real gateway routing to a real model, because the whole
 * card is about strings a person hands to something outside the browser
 * and an install with nothing running has no model id to give.
 *
 * What it proves here: the card appears with the three strings, the key
 * the browser makes actually works against the gateway **on the path a
 * harness takes** — a bare `fetch` to the gateway's own address with
 * only that bearer, no proxy, no session — and turning the key off makes
 * that same request fail. The script checks the same things from
 * `curl`, outside any browser, because a reference client that shares
 * its path with the thing it tests proves nothing (§7.1 of the
 * agent-clients design).
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const GATEWAY = process.env.EP_GATEWAY_URL ?? "http://127.0.0.1:8180";

/**
 * Sign in, and do not trust the first fill.
 *
 * `output: export` serves the login form as static HTML, and React
 * replaces it on hydration with a controlled input whose state is the
 * empty string — so a `fill` that lands in the window between "visible"
 * and "hydrated" is silently discarded, leaving a filled-looking form
 * that submits nothing and a disabled button. That is what the second
 * execution of `client-keys-acceptance.sh` hit: all three tests timed
 * out on a page whose accessibility tree showed an empty Passphrase box
 * and `button "Unlock" [disabled]`.
 *
 * The same family as M9's *"`isVisible()` does not wait"* and S1's *"the
 * page menu renders after the setup gate"*: a check looking somewhere
 * its subject has not arrived. The fix asserts the value stuck and
 * re-fills until it does, then waits for the button the form itself
 * enables.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  const unlock = page.getByRole("button", { name: /Unlock|Sign in/i });
  await expect(async () => {
    await field.fill(PASSPHRASE);
    await expect(field).toHaveValue(PASSPHRASE, { timeout: 1_000 });
    await expect(unlock).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await unlock.click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

/** A request shaped exactly like a harness's: address, bearer, nothing else. */
async function asHarness(page: Page, key: string): Promise<number> {
  return page.evaluate(
    async ([base, bearer]) => {
      const response = await fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return response.status;
    },
    [GATEWAY, key],
  );
}

test.describe("client keys", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Home shows the three strings, and the key it makes works from outside", async ({
    page,
  }) => {
    await page.goto("/");
    const card = page.getByTestId("home-use-from-apps");
    await expect(card).toBeVisible({ timeout: 60_000 });

    // The address carries /v1 — §3's failure #6, the one every comparable
    // project's issue tracker carries.
    const address = await card.getByTestId("base-url").innerText();
    expect(address).toMatch(/\/v1$/);

    // The model id is the gateway's own spelling, not a friendly name.
    const model = await card.getByTestId("app-model").innerText();
    expect(model.trim().length).toBeGreaterThan(0);

    await card.getByTestId("key-name").fill("Playwright");
    await card.getByTestId("make-key").click();
    const shown = card.getByTestId("fresh-key");
    await expect(shown).toBeVisible({ timeout: 30_000 });
    const key = (await shown.innerText()).trim();
    expect(key.split(".")).toHaveLength(3);

    // The point of the whole slice: this string, on its own, over the
    // network, with nothing of ours in the way.
    expect(await asHarness(page, key)).toBe(200);

    // And the record shows it without the token.
    const list = card.getByTestId("key-list");
    await expect(list).toContainText("Playwright");
    await expect(list).not.toContainText(key);
  });

  test("turning a key off stops it, and leaves the others alone", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("home-use-from-apps");
    await expect(card).toBeVisible({ timeout: 60_000 });

    await card.getByTestId("key-name").fill("Keeper");
    await card.getByTestId("make-key").click();
    await expect(card.getByTestId("fresh-key")).toBeVisible({ timeout: 30_000 });
    const keeper = (await card.getByTestId("fresh-key").innerText()).trim();

    await card.getByTestId("key-name").fill("Doomed");
    await card.getByTestId("make-key").click();
    await expect(card.getByTestId("key-list")).toContainText("Doomed", { timeout: 30_000 });
    const doomed = (await card.getByTestId("fresh-key").innerText()).trim();

    expect(await asHarness(page, keeper)).toBe(200);
    expect(await asHarness(page, doomed)).toBe(200);

    await card
      .getByTestId("key-list")
      .locator("li", { hasText: "Doomed" })
      .getByRole("button", { name: /Turn off/i })
      .click();
    await expect(card.getByTestId("key-list")).not.toContainText("Doomed", { timeout: 30_000 });

    // The gateway caches the revoked list for a refresh interval, so this
    // is a poll rather than an assertion — and the poll is the proof the
    // bound in the contract is real rather than aspirational.
    await expect
      .poll(async () => asHarness(page, doomed), { timeout: 60_000, intervals: [1000] })
      .toBe(401);

    // If revoking one took them all down there would be no reason to
    // mint more than one, and this would be the signing-key rotation
    // with extra steps.
    expect(await asHarness(page, keeper)).toBe(200);
  });

  test("a client key opens nothing but the front door", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("home-use-from-apps");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByTestId("key-name").fill("Scoped");
    await card.getByTestId("make-key").click();
    await expect(card.getByTestId("fresh-key")).toBeVisible({ timeout: 30_000 });
    const key = (await card.getByTestId("fresh-key").innerText()).trim();

    // Two refusals stand between this page and the gateway's config, and
    // the browser meets the FIRST one: `/v1/config` deliberately answers
    // no CORS, so Chrome blocks the request before a status exists and
    // `fetch` rejects. The first run of this spec asserted 401 and read
    // that rejection as a failure -- the audience check is real (the
    // script's own `curl` gets the 401), but it is not what a browser
    // observes. Either refusal is correct; a 200 is not.
    const outcome = await page.evaluate(
      async ([base, bearer]) => {
        try {
          const response = await fetch(`${base}/v1/config`, {
            headers: { Authorization: `Bearer ${bearer}` },
          });
          return String(response.status);
        } catch {
          return "blocked-by-browser";
        }
      },
      [GATEWAY, key],
    );
    expect(["401", "blocked-by-browser"]).toContain(outcome);

    // And the same page CAN reach the front door with the same key, so
    // the refusal above is about that path rather than about the fetch
    // being broken in this context.
    expect(await asHarness(page, key)).toBe(200);
  });
});
