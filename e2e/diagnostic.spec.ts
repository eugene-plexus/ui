/**
 * The playground as a diagnostic, driven by a real browser.
 *
 * Only a browser can prove the thing this feature is for: that a page on
 * one origin can reach the gateway on another, through CORS, with a
 * bearer, and stream. `curl` does not enforce the same-origin policy, so
 * a curl-only check of the gateway's CORS headers proves the headers are
 * present and nothing about whether Chrome accepts them.
 *
 * Runs against a throwaway install started by
 * `scripts/playground-diagnostic-acceptance.sh` in the specs repo, which
 * also reads the results file this spec writes -- each browser check is a
 * named boolean with the evidence beside it, so the acceptance record can
 * quote what was observed rather than that a test passed.
 *
 * Serial and single-worker: one transcript, one order, and every step
 * builds on the one before it (the tool result answers the tool call).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
/** What the panel should prefill: this page's host + the gateway's port, as `/v1`. */
const EXPECTED_BASE_URL = process.env.EP_EXPECTED_BASE_URL ?? "";
/** An address that is NOT the gateway (the agent's own port), for the misconfiguration check. */
const WRONG_BASE_URL = process.env.EP_WRONG_BASE_URL ?? "";
const RESULTS_FILE = process.env.EP_RESULTS_FILE ?? "";
const CANARY = `CANARY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const GENERATION_TIMEOUT = 180_000;

const results: Record<string, { ok: boolean; detail: string }> = {};
function record(name: string, ok: boolean, detail: string) {
  results[name] = { ok, detail };
  if (RESULTS_FILE) writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

test.describe.configure({ mode: "serial" });

test.describe("the playground as a diagnostic", () => {
  let page: Page;
  let firstPromptTokens = 0;
  let curlLine = "";

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
    // The diagnostic lives on the playground, which is `/playground`
    // since Home took the root (hobbyist UX, S1).
    await page.goto("/playground");
    await page.getByTestId("toggle-diagnostic").click();
    await expect(page.getByTestId("mode-direct")).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("direct mode is prefilled with the gateway's address and a turn round-trips", async () => {
    await page.getByTestId("mode-direct").click();
    const baseUrl = page.getByTestId("base-url");
    await expect(baseUrl).toBeVisible();
    // The guess arrives after GET /v1/components; wait for a value.
    await expect(baseUrl).not.toHaveValue("", { timeout: 30_000 });
    const prefilled = await baseUrl.inputValue();
    const prefillOk = EXPECTED_BASE_URL === "" || prefilled === EXPECTED_BASE_URL;
    record(
      "prefill",
      prefillOk,
      `prefilled ${prefilled}; expected ${EXPECTED_BASE_URL || "(unset)"}`,
    );
    expect(prefilled, "base URL prefilled from the topology").toBe(EXPECTED_BASE_URL || prefilled);

    const key = await page.getByTestId("api-key").inputValue();
    const token = await page.evaluate(() => sessionStorage.getItem("eugene-session-token"));
    record("key-is-session-token", key === token && !!token, `key length ${key.length}`);
    expect(key).toBe(token);

    // The model list came direct too; the picker must have something.
    await expect(page.locator("select").first()).toBeVisible({ timeout: 60_000 });

    await send(page, "Reply with the single word: ok");
    const summary = page.getByTestId("report-summary");
    await expect(summary).toBeVisible({ timeout: GENERATION_TIMEOUT });
    await expect(summary).toHaveAttribute("data-status", "200", { timeout: GENERATION_TIMEOUT });
    const mode = await summary.getAttribute("data-mode");
    const frames = Number(await summary.getAttribute("data-frames"));
    const driver = await summary.getAttribute("data-driver");
    firstPromptTokens = Number(await summary.getAttribute("data-prompt-tokens"));
    const text = (await summary.textContent()) ?? "";
    record(
      "direct-turn",
      mode === "direct" && frames > 1 && !!driver,
      `mode=${mode} frames=${frames} driver=${driver} prompt_tokens=${firstPromptTokens} :: ${text.trim()}`,
    );
    expect(mode).toBe("direct");
    expect(frames, "a streamed answer arrives in more than one frame").toBeGreaterThan(1);
    expect(driver, "the envelope names the driver").toBeTruthy();
  });

  test("with the example tool on, the model calls it and the operator's result closes the loop", async () => {
    await page.getByTestId("tools-enabled").check();
    await send(page, "What is the weather in Oslo? Use your tools.");

    const card = page.getByTestId("tool-call-card").first();
    await expect(card).toBeVisible({ timeout: GENERATION_TIMEOUT });
    await expect(card).toContainText("get_weather", { timeout: GENERATION_TIMEOUT });
    await expect(card).toContainText("arguments parse", { timeout: GENERATION_TIMEOUT });
    const cardText = (await card.textContent()) ?? "";
    const summary = page.getByTestId("report-summary");
    await expect(summary).toHaveAttribute("data-status", "200", { timeout: GENERATION_TIMEOUT });
    const deltas = Number(await summary.getAttribute("data-tool-call-deltas"));
    record(
      "tool-call",
      /get_weather/.test(cardText) && /city/.test(cardText) && deltas >= 1,
      `tool-call deltas=${deltas} :: ${cardText.replace(/\s+/g, " ").trim()}`,
    );
    expect(cardText).toMatch(/city/);
    expect(deltas).toBeGreaterThanOrEqual(1);

    // The prefilled result is the acceptance run's: -3 and snow.
    const result = page.getByTestId("tool-result").first();
    await expect(result).toHaveValue(/tempC/);
    await page.getByTestId("send-tool-results").click();
    await expect(page.getByTestId("tool-result-message").first()).toBeVisible();
    const answer = page
      .locator("div.group")
      .filter({ hasNot: page.getByTestId("tool-call-card") })
      .last();
    await expect(answer).toContainText(/-3|snow/i, { timeout: GENERATION_TIMEOUT });
    const answerText = (await answer.textContent()) ?? "";
    record(
      "tool-loop-closed",
      /-3|snow/i.test(answerText),
      answerText.replace(/\s+/g, " ").trim().slice(0, 300),
    );
  });

  test("an attached text file is inlined and the model reads it", async () => {
    // Tools stay on: a harness that pastes a file usually has tools on too,
    // and the point is that both ride on one request.
    const dir = mkdtempSync(join(tmpdir(), "ep-diag-"));
    const path = join(dir, "notes.txt");
    const filler = Array.from({ length: 60 }, (_, i) => `line ${i + 1}: nothing to see here`).join(
      "\n",
    );
    writeFileSync(path, `${filler}\nThe codeword is ${CANARY}.\n${filler}\n`);
    await page.getByTestId("attach-input").setInputFiles(path);
    await expect(page.getByTestId("attachment-chip")).toContainText("notes.txt");
    await send(page, "What is the codeword in the attached file? Reply with only the codeword.");

    const summary = page.getByTestId("report-summary");
    await expect(summary).toHaveAttribute("data-status", "200", { timeout: GENERATION_TIMEOUT });
    const promptTokens = Number(await summary.getAttribute("data-prompt-tokens"));
    const last = page.locator("div.group").last();
    await expect(last).toContainText(CANARY, { timeout: GENERATION_TIMEOUT });
    const ok = promptTokens > firstPromptTokens;
    record(
      "attachment",
      ok,
      `answer carried ${CANARY}; prompt_tokens ${promptTokens} vs ${firstPromptTokens} for the first turn`,
    );
    expect(promptTokens).toBeGreaterThan(firstPromptTokens);

    // The report's curl for this exact request, for the shell to replay.
    await summary.click();
    const curl = page.getByTestId("report-curl");
    await expect(curl).toBeVisible();
    curlLine = (await curl.textContent()) ?? "";
    record("curl-present", curlLine.startsWith("curl -sN"), curlLine.slice(0, 200));
    expect(curlLine).toMatch(/^curl -sN '/);
    expect(curlLine).toContain("$EUGENE_PLEXUS_TOKEN");
    if (RESULTS_FILE) writeFileSync(`${RESULTS_FILE}.curl`, curlLine);
  });

  test("pointed at the wrong port, direct mode fails and says so; the proxy still works", async () => {
    test.skip(!WRONG_BASE_URL, "no EP_WRONG_BASE_URL");
    const baseUrl = page.getByTestId("base-url");
    await baseUrl.fill(WRONG_BASE_URL);
    await baseUrl.blur();
    await send(page, "Reply with the single word: ok");
    const summary = page.getByTestId("report-summary");
    await expect(summary).toHaveAttribute("data-mode", "direct", { timeout: 60_000 });
    await expect
      .poll(async () => (await summary.getAttribute("data-status")) ?? "", { timeout: 60_000 })
      .not.toBe("200");
    const status = await summary.getAttribute("data-status");
    await summary.click();
    const reportText = (await page.getByTestId("request-report").textContent()) ?? "";
    const namesUrl = reportText.includes(WRONG_BASE_URL.replace(/\/v1\/?$/, ""));
    record(
      "wrong-port",
      status === "404" && namesUrl,
      `status=${status}; report names the URL: ${namesUrl}`,
    );
    expect(status).toBe("404");
    expect(namesUrl).toBe(true);

    await page.getByTestId("mode-proxy").click();
    await send(page, "Reply with the single word: ok");
    await expect(summary).toHaveAttribute("data-mode", "proxy", { timeout: GENERATION_TIMEOUT });
    await expect(summary).toHaveAttribute("data-status", "200", { timeout: GENERATION_TIMEOUT });
    record("proxy-still-works", true, (await summary.textContent())?.trim() ?? "");
  });
});

async function send(page: Page, text: string): Promise<void> {
  // By test id, not `locator("textarea").first()`: with the diagnostic
  // panels open the first textarea on the page is the tools editor,
  // disabled while tools are off -- and the first run of this spec waited
  // a minute on it. A selector that names its subject cannot pick the
  // wrong one.
  const input = page.getByTestId("composer");
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(text);
  await input.press("Enter");
}

/**
 * Sign in through the real form, the way the auth arc does -- and wait
 * for the form rather than asking whether it is there (`isVisible()`
 * does not auto-wait; M9 paid for that).
 */
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
