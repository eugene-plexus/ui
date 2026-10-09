/**
 * P8 in a real browser: add a search account, find it in the tree, and
 * search from the playground.
 *
 * Runs against a throwaway install started by
 * `scripts/p8-search-acceptance.py --browser` in the specs repo: a real
 * control root, agent and gateway, a local model that calls tools, and a
 * SearXNG-shaped fixture. The script reads the results file this writes.
 */

import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "";
const SEARX_URL = process.env.EP_SEARX_URL ?? "";
const MODEL = process.env.EP_MODEL ?? "p8-local";
const ANSWER = process.env.EP_ANSWER_MARK ?? "P8-FIXTURE-ANSWER";
const RESULTS_FILE = process.env.EP_RESULTS_FILE ?? "";

const results: Record<string, { ok: boolean; detail: string }> = {};
function record(name: string, ok: boolean, detail: string) {
  results[name] = { ok, detail };
  if (RESULTS_FILE) writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

test.describe.configure({ mode: "serial" });

test.describe("a search account, end to end", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("adds a SearXNG account through the page, which runs a test search", async () => {
    await page.goto("/backends/search");
    await expect(page.getByRole("heading", { name: "Add a search account" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("search-provider-searxng").check();
    await page.getByTestId("search-address").fill(SEARX_URL);
    await page.getByTestId("search-add-button").click();
    const done = page.getByTestId("search-added");
    await expect(done).toBeVisible({ timeout: 90_000 });
    const text = (await done.textContent()) ?? "";
    expect(text).toContain("web search is on");
    record("add", true, text.trim().slice(0, 200));
  });

  test("lists it under Backends, with its settings a click away", async () => {
    await page.goto("/inference?sel=backends");
    const row = page.locator(
      '[data-tree-sel="driver:searxng"], [data-tree-sel^="driver:searxng@"]',
    );
    await expect(row.first()).toBeVisible({ timeout: 60_000 });
    await row.first().click();
    await expect(page.getByText("Search provider").first()).toBeVisible({ timeout: 60_000 });
    record("tree", true, "a searxng row under Backends opens its Settings");
  });

  test("searches from the playground and shows the sources", async () => {
    await page.goto("/playground?search=1");
    await expect(page.getByTestId("playground-web-search")).toBeChecked({ timeout: 60_000 });
    const picker = page.locator("select").first();
    await expect(picker).toBeVisible({ timeout: 60_000 });
    await picker.selectOption(MODEL);
    const input = page.getByTestId("composer");
    await expect(input).toBeEnabled({ timeout: 60_000 });
    await input.fill("What is Eugene Plexus?");
    await input.press("Enter");
    const reply = page.locator("div.group").last();
    await expect(reply).toContainText(ANSWER, { timeout: 120_000 });
    const sources = page.getByTestId("message-sources").last();
    await expect(sources).toBeVisible({ timeout: 30_000 });
    const link = sources.locator("a").first();
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(/^https?:\/\//);
    await expect(page.getByText(/1 web search\b/)).toBeVisible();
    record("playground", true, `answered with a source: ${href}`);
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock/i }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:[?#].*)?$/, { timeout: 120_000 });
  const token = await page.evaluate(() => sessionStorage.getItem("eugene-session-token"));
  expect(token, "no session token after signing in").toBeTruthy();
}
