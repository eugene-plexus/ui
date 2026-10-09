/**
 * PB2's done-when, in a browser: build, save and launch a profile, and the
 * launched model's row matches what was saved (profile-builder.md §8).
 *
 * The runner (`specs/scripts/pb2-browser-acceptance.py`) stands up a
 * throwaway agent with its own library, a CPU-only llama.cpp build and one
 * small model, so the live install and its graphics card are never
 * touched. Every step writes a line to EP_RESULTS_FILE, which the runner
 * prints and then checks against the agent's own API.
 */

import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "";
const MODEL_ID = process.env.EP_MODEL_ID ?? "";
const RESULTS = process.env.EP_RESULTS_FILE ?? "";
const BUILD_MS = Number(process.env.EP_BUILD_BUDGET_MS ?? 15 * 60_000);
const results: Record<string, { ok: boolean; detail: string }> = {};

function record(check: string, ok: boolean, detail: string): void {
  results[check] = { ok, detail };
  if (RESULTS) writeFileSync(RESULTS, JSON.stringify(results, null, 2));
}

async function step(check: string, body: () => Promise<string>): Promise<void> {
  try {
    record(check, true, await body());
  } catch (error) {
    record(check, false, String(error).slice(0, 600));
    throw error;
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  // A static export's form is inert until React hydrates, and a fill before
  // then is silently discarded (S4's finding). The button stays disabled
  // until a passphrase is in the box, so fill until it enables.
  const unlock = page.getByRole("button", { name: /Unlock|Sign in/i });
  await expect(async () => {
    await field.fill(PASSPHRASE);
    await expect(unlock).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await unlock.click();
  await expect(page.getByTestId("resource-tree").first()).toBeVisible({ timeout: 120_000 });
}

test.describe.configure({ mode: "serial" });

test("build, save and launch a profile from the model's page", async ({ page }) => {
  test.setTimeout(BUILD_MS + 10 * 60_000);
  await signIn(page);

  await step("open", async () => {
    await page.goto(`/library?model=${encodeURIComponent(MODEL_ID)}`);
    const open = page.getByTestId("profile-builder-open");
    await expect(open).toBeEnabled({ timeout: 60_000 });
    await open.click();
    await expect(page.getByTestId("accuracy-promise")).toHaveText(
      "Answers exactly as this file allows. Nothing that changes answers is tried.",
      { timeout: 60_000 },
    );
    return "the button is on the model's page, and Max is the default";
  });

  await step("preflight", async () => {
    const start = page.getByTestId("measurement-start");
    await expect(start).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("stop-question")).toHaveCount(0);
    const estimate = (await page.getByTestId("measurement-estimate").textContent()) ?? "";
    return `nothing running to stop; the node says: ${estimate.trim()}`;
  });

  await step("start", async () => {
    await page.getByTestId("measurement-start").click();
    await expect(page.getByTestId("build-progress")).toBeVisible({ timeout: 60_000 });
    return (await page.getByTestId("build-progress").textContent())?.slice(0, 200) ?? "";
  });

  await step("result", async () => {
    const result = page.getByTestId("build-result");
    await expect(result).toBeVisible({ timeout: BUILD_MS });
    await expect(result).toHaveAttribute("data-state", "completed");
    const stop = (await page.getByTestId("build-stop").textContent()) ?? "";
    expect(stop).toMatch(/About \d+ words a second · holds about [\d,]+ pages · suggested/);
    expect(stop).toContain("Answers exactly as this file allows.");
    return stop.trim();
  });

  await step("save", async () => {
    await page.getByTestId("build-save").click();
    const saved = page.getByTestId("build-result").getByRole("status");
    await expect(saved).toContainText("Saved as Built for", { timeout: 30_000 });
    return (await saved.textContent())?.trim() ?? "";
  });

  await step("measured", async () => {
    const measured = page.getByTestId("profile-measured");
    await expect(measured).toBeVisible({ timeout: 30_000 });
    await expect(measured).toHaveAttribute("data-edited", "false");
    return (await measured.textContent())?.trim() ?? "";
  });

  await step("launch", async () => {
    // The row of the profile just saved: it carries the measured line.
    const row = page.getByTestId("profile-measured").locator("xpath=..");
    await row.getByRole("button", { name: "launch" }).click();
    await expect(page.getByText(/^Starting /)).toBeVisible({ timeout: 60_000 });
    return (await page.getByText(/^Starting /).textContent())?.slice(0, 200) ?? "";
  });

  await step("running", async () => {
    // The model's own page says it is up once the engine answers.
    await expect(page.getByTestId("model-fit")).toHaveAttribute("data-resident", "true", {
      timeout: 5 * 60_000,
    });
    return (await page.getByTestId("model-fit").textContent())?.slice(0, 200) ?? "";
  });

  await step("phone", async () => {
    // S9's rule at a phone's width: the builder's result, slider and Save
    // row fit without the page scrolling sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/library?model=${encodeURIComponent(MODEL_ID)}`);
    await page.getByTestId("profile-builder-open").click();
    const result = page.getByTestId("build-result");
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.scrollIntoViewIfNeeded();
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: window.innerWidth,
      panel: document.querySelector('[data-testid="build-result"]')?.getBoundingClientRect().right,
    }));
    expect(widths.page).toBeLessThanOrEqual(widths.view + 1);
    expect(widths.panel ?? 0).toBeLessThanOrEqual(widths.view + 1);
    return `at 390 px the page is ${widths.page} px wide and the result ends at ${Math.round(widths.panel ?? 0)} px`;
  });
});
