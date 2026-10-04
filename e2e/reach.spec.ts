import { expect, test } from "@playwright/test";

const BASE = process.env.EP_BASE ?? "http://127.0.0.1:8179";
const PASS = process.env.EP_PASS ?? "";

// A login form served by `output: export` is inert HTML until React
// hydrates, and a `fill` landing in that window is silently discarded
// (S4's finding (c)). Re-fill until the value sticks.
async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`);
  const box = page.getByLabel(/passphrase/i).first();
  await box.waitFor({ state: "visible" });
  await expect(async () => {
    await box.fill(PASS);
    expect(await box.inputValue()).toBe(PASS);
  }).toPass({ timeout: 15000 });
  await page.getByRole("button", { name: /unlock|sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

test("Home offers the address a phone would use, and the switch turns it on", async ({ page }) => {
  await signIn(page);
  await page.goto(BASE);
  const card = page.getByTestId("home-reach");
  await card.waitFor({ state: "visible", timeout: 20000 });

  const headline = card.getByTestId("reach-headline");
  await expect(headline).toContainText("Only this PC");
  // The address in the card is the one a phone would type, not loopback.
  await expect(headline).not.toContainText("127.0.0.1");

  const toggle = card.getByTestId("reach-switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();

  // The switch does not report success it has not got: the agent's own
  // socket has not moved, and the card says so rather than leaving it to
  // be discovered on a phone.
  await expect(card.getByTestId("reach-headline")).toContainText(/restart/i, { timeout: 30000 });
});
