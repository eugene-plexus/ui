/**
 * Signing in unlocks a sealed control root -- in a browser, against a root
 * that really is sealed.
 *
 * Reported from the live install (2026-09-13): after a container update the
 * UI asked for the passphrase at sign-in and `/nodes` asked for it again.
 * The runner (`specs/scripts/login-unlock-check.sh`) restarts the control
 * root so it comes back locked, asserts with curl that it 503s, and then
 * this spec signs in through the real form and asks the root a question
 * it can only answer unlocked.
 */

import { expect, test } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";

test("signing in through the form unlocks the control root", async ({ page }) => {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock/i }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:[?#].*)?$/, { timeout: 120_000 });
  const token = await page.evaluate(() => sessionStorage.getItem("eugene-session-token"));
  expect(token, "no session token after signing in").toBeTruthy();

  // The root answers this only when unlocked; sealed, it is a 503 `Locked`.
  const nodes = await page.request.get("/api/proxy/control/v1/nodes", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await nodes.text();
  expect(nodes.status(), body).toBe(200);
  expect(JSON.parse(body)).toHaveProperty("nodes");
});
