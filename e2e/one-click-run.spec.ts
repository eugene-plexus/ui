/**
 * One-click run, in a browser, against a fresh box (hobbyist UX §7 S3).
 *
 * The runner (`specs/scripts/one-click-run-acceptance.sh`) stands up an
 * install with NO llama.cpp — the engine root is pointed at an empty
 * directory — and one model on disk, downloaded through the library. What
 * a browser proves that jsdom cannot: the Run button is where the person
 * is (Home, the finished download, the model), the one question appears
 * and is answered, a real engine is fetched, a real runtime reaches
 * `ready`, and the first reply lands on Home.
 *
 * Order matters and the tests say so: Skip first, so a stopped runtime
 * with its reason is asserted on Inference; then Run again with Install,
 * which must START that runtime rather than declare a second.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
/** The library's id for the one model on disk. */
const MODEL_ID = process.env.EP_MODEL_ID ?? "";
/** Its name as the library lists it (the file's stem). */
const MODEL_NAME = process.env.EP_MODEL_NAME ?? "";
/** The runtime Run declares for it: the name's slug. */
const RUNTIME = MODEL_NAME.toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
/** How long a real engine install plus a model load may take. */
const INSTALL_AND_LOAD_MS = Number(process.env.EP_RUN_BUDGET_MS ?? 15 * 60_000);

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("One-click run on a fresh box", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Home offers to run the one model on disk, in one click", async ({ page }) => {
    // What the page was told, printed on failure: a card that computes
    // "not runnable here" from two polled bodies is only debuggable with
    // the bodies, and the trace does not keep them.
    const seen: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (/\/v1\/(models|engines)(\?|$)/.test(url)) {
        void response
          .text()
          .then((text) => seen.push(`${response.status()} ${url}\n${text.slice(0, 1500)}`))
          .catch(() => undefined);
      }
    });
    await page.goto("/");
    const card = page.getByTestId("home-first-model");
    await expect(card).toHaveAttribute("data-state", "none-running", { timeout: 60_000 });
    const strip = await page.getByTestId("home-machine").textContent();
    await expect
      .soft(card, `strip: ${strip}\nbodies:\n${seen.join("\n---\n")}`)
      .toContainText(`${MODEL_NAME} is on disk and not running.`);
    const run = card.getByTestId("run-button");
    await expect(run).toHaveText(`Run ${MODEL_NAME}`);
    await expect(run).toBeEnabled();
    // The list-of-one is gone from the primary position.
    await expect(card.getByRole("link", { name: "Choose a model to run" })).toHaveCount(0);
    // And the words are the person's.
    const text = ((await card.textContent()) ?? "").toLowerCase();
    for (const word of ["runtime", "admission", "declaration", "companion"]) {
      expect(text, `Home's card says "${word}"`).not.toContain(word);
    }
  });

  test("a finished download offers Run in place, beside the library link", async ({ page }) => {
    // The runner can copy a local file in instead of downloading (its
    // EP_LOCAL_GGUF, for iterating); there is no download record then.
    test.skip(process.env.EP_DOWNLOADED !== "1", "the model was copied in, not downloaded");
    await page.goto("/library");
    const row = page.getByTestId("download-row").filter({ hasText: MODEL_NAME }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toHaveAttribute("data-download-state", "done");
    // The Run button sits in the same row as the link that used to be the
    // only way onward.
    await expect(row.getByTestId("download-open-library")).toBeVisible();
    await expect(row.getByTestId("run-button")).toBeVisible();
    await expect(row.getByTestId("run-button")).toHaveText("Run");
  });

  test("Skip leaves the model listed on Inference as stopped, with the reason", async ({
    page,
  }) => {
    await page.goto(`/library?model=${encodeURIComponent(MODEL_ID)}`);
    const detail = page.getByTestId("model-run");
    await expect(detail).toBeVisible({ timeout: 60_000 });
    // The old sentence is gone: nothing sends the person to Inference to
    // install an engine.
    await expect(page.getByText(/Install one from the/)).toHaveCount(0);
    await expect(detail).toContainText("Run asks before installing it");

    await detail.getByTestId("run-button").click();
    const dialog = page.getByTestId("run-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText("I could not find llama.cpp on");
    await expect(dialog).toContainText("Install it now?");
    // Install is the default: it holds focus.
    await expect(dialog.getByTestId("run-install")).toBeFocused();
    await expect(dialog).toContainText("Skip is for advanced users");

    await dialog.getByTestId("run-skip").click();
    const status = detail.getByTestId("run-status");
    await expect(status).toHaveAttribute("data-step", "skipped", { timeout: 60_000 });
    await expect(status).toContainText("not started: llama.cpp is not installed on");
    await expect(status).toContainText("listed on Inference as stopped");

    // The tray carries the same run, on this screen and any other.
    await page.getByTestId("tasks-tray").click();
    const popover = page.getByTestId("tasks-popover");
    await expect(popover.locator('a[data-task-kind="run"]')).toContainText(`Run ${MODEL_NAME} on`);
    await page.keyboard.press("Escape");

    // Inference: the runtime, stopped, and the reason in plain words.
    await page.goto("/inference");
    const row = page.locator("tr", { hasText: RUNTIME }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText("stopped");
    await expect(row.getByTestId("stopped-reason")).toContainText(
      "llama.cpp is not installed on this machine, so this cannot start.",
    );
  });

  test("Run again installs llama.cpp on Install, starts the same runtime, and reaches ready", async ({
    page,
  }) => {
    test.setTimeout(INSTALL_AND_LOAD_MS + 120_000);
    await page.goto(`/library?model=${encodeURIComponent(MODEL_ID)}`);
    const detail = page.getByTestId("model-run");
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await detail.getByTestId("run-button").click();
    const dialog = page.getByTestId("run-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByTestId("run-install").click();

    const status = detail.getByTestId("run-status");
    // The install is reported where the person is looking, with the bytes.
    await expect(status).toHaveAttribute("data-step", "installing", { timeout: 60_000 });
    await expect(status).toContainText("installing llama.cpp", { timeout: 60_000 });
    // ...and it ends ready, with no other click.
    await expect(status).toHaveAttribute("data-step", "ready", {
      timeout: INSTALL_AND_LOAD_MS,
    });
    await expect(status).toContainText("ready — try it on Home");
    await expect(status.getByTestId("run-try-it")).toHaveAttribute("href", "/");
  });

  test("the first reply lands on Home", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await page.goto("/");
    // The gateway lists the model within a routing refresh of `ready`.
    const tryIt = page.getByTestId("home-try-it");
    await expect(tryIt).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("home-first-model")).toHaveCount(0);
    const composer = tryIt.getByTestId("home-composer");
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    await composer.fill("Reply with the single word: ok");
    await tryIt.getByRole("button", { name: "Send" }).click();
    await expect(tryIt.getByTestId("home-turn-info")).toBeVisible({ timeout: 180_000 });
    await expect(tryIt.getByTestId("home-turn-info")).toContainText(RUNTIME);
  });
});
