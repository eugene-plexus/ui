/**
 * The playground's other doors, driven by a real browser (U7 of
 * playground-doors.md).
 *
 * Runs against a throwaway install started by
 * `scripts/playground-doors-acceptance.py` in the specs repo: a real
 * control root, agent, gateway and drivers in front of the P2-P6 gates'
 * own fixture backends, with this UI served by the agent. The script
 * reads the results file this spec writes, so the record quotes what was
 * observed. jsdom cannot tell whether Chrome plays the audio it is handed,
 * sends a real multipart body, or can read a response header across
 * origins; this can.
 */

import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const GATEWAY_URL = process.env.EP_GATEWAY_URL ?? "";
const FOX = process.env.EP_FOX ?? "";
const RESULTS_FILE = process.env.EP_RESULTS_FILE ?? "";

const results: Record<string, { ok: boolean; detail: string }> = {};
function record(name: string, ok: boolean, detail: string) {
  results[name] = { ok, detail };
  if (RESULTS_FILE) writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

/** A tiny valid WAV: 44-byte header, 800 samples of silence. */
function wav(): Buffer {
  const pcm = Buffer.alloc(1600);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Not serial: each door is its own check, so one failing does not hide
// the rest. A failure restarts the worker, and beforeAll signs in again.
test.describe.configure({ mode: "default" });

test.describe("the playground's other doors", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  async function openDoor(door: string, model: string) {
    await page.goto(`/playground?door=${door}`);
    await expect(page.getByTestId(`${door}-door`)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("door-model").selectOption(model);
  }

  async function servedBy(): Promise<string> {
    const summary = page.getByTestId("door-report-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    return (await summary.getAttribute("data-driver")) ?? "";
  }

  test("completions fill in the middle", async () => {
    await openDoor("completion", "coder");
    await page.getByTestId("completion-prompt").fill("def add(a, b):\n    return");
    await page.getByTestId("completion-suffix").fill("\n\nprint(add(1, 2))\n");
    await page.getByTestId("completion-send").click();
    const answer = page.getByTestId("completion-answer");
    await expect(answer).not.toHaveText("", { timeout: 60_000 });
    const text = (await answer.textContent()) ?? "";
    const driver = await servedBy();
    record(
      "completion",
      text.length > 0 && driver === "coder",
      `answer ${JSON.stringify(text)}; driver ${driver}`,
    );
    expect(driver).toBe("coder");
  });

  test("speech plays, and says what served it, through the proxy", async () => {
    await openDoor("speech", "audio/acme/kokoro");
    await page.getByTestId("speech-input").fill("Good morning from the playground.");
    await page.getByTestId("speech-send").click();
    const audio = page.getByTestId("speech-audio");
    await expect(audio).toBeVisible({ timeout: 60_000 });
    const src = (await audio.getAttribute("src")) ?? "";
    const driver = await servedBy();
    record(
      "speech-proxy",
      src.startsWith("data:audio/") && driver === "audio",
      `src ${src.slice(0, 30)}...; driver ${driver}`,
    );
    expect(driver).toBe("audio");
  });

  test("speech says what served it in direct mode too, across origins", async () => {
    test.skip(!GATEWAY_URL, "no EP_GATEWAY_URL");
    await openDoor("speech", "audio/acme/kokoro");
    await page.getByTestId("toggle-diagnostic").click();
    await page.getByTestId("mode-direct").click();
    await page.getByTestId("base-url").fill(GATEWAY_URL);
    await page.getByTestId("speech-send").click();
    await expect(page.getByTestId("speech-audio")).toBeVisible({ timeout: 60_000 });
    const summary = page.getByTestId("door-report-summary");
    const mode = (await summary.getAttribute("data-mode")) ?? "";
    const driver = await servedBy();
    record(
      "speech-direct",
      mode === "direct" && driver === "audio",
      `mode ${mode}; driver ${driver} (read off x-eugene-plexus-driver, exposed by CORS)`,
    );
    expect(mode).toBe("direct");
    expect(driver).toBe("audio");
    await page.getByTestId("mode-proxy").click();
  });

  test("a recording is transcribed, and translated", async () => {
    test.skip(!FOX, "no EP_FOX");
    await openDoor("transcription", "audio/acme/whisper");
    await page.getByTestId("transcription-file").setInputFiles(FOX);
    await page.getByTestId("transcription-send").click();
    const text = page.getByTestId("transcription-text");
    await expect(text).not.toHaveText("", { timeout: 60_000 });
    const said = (await text.textContent()) ?? "";
    record(
      "transcription",
      said.length > 0,
      `text ${JSON.stringify(said)}; driver ${await servedBy()}`,
    );

    await page.getByTestId("task-translate").check();
    await page.getByTestId("door-model").selectOption("oai-audio/whisper-1");
    await page.getByTestId("transcription-file").setInputFiles(FOX);
    await page.getByTestId("transcription-send").click();
    await expect(page.getByTestId("door-report-summary")).toHaveAttribute("data-status", "200", {
      timeout: 60_000,
    });
    const english = (await text.textContent()) ?? "";
    record("translation", english.length > 0, `text ${JSON.stringify(english)}`);
  });

  test("a picture is made after the spending is confirmed, and one is changed with a mask", async () => {
    // acme/mini answers a real PNG; the fixture's JPEG for acme/flux is
    // bytes no browser can decode, which would test the fixture.
    await openDoor("image", "pictures/acme/mini");
    await page.getByTestId("image-send").click();
    await expect(page.getByText(/bills the account/)).toBeVisible();
    await page.getByTestId("image-send-confirm").click();
    const result = page.getByTestId("image-result").first();
    await expect(result).toBeVisible({ timeout: 60_000 });
    const loaded = await result.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    );
    record(
      "image-generate",
      loaded,
      `the browser decoded it: ${loaded}; driver ${await servedBy()}`,
    );

    await page.getByTestId("door-model").selectOption("oai-images/gpt-image-1");
    await page.getByTestId("image-mode-edit").check();
    await page
      .getByTestId("image-files")
      .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await page
      .getByTestId("image-mask")
      .setInputFiles({ name: "m.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("image-send").click();
    await page.getByTestId("image-send-confirm").click();
    await expect(page.getByTestId("door-report-summary")).toHaveAttribute("data-status", "200", {
      timeout: 60_000,
    });
    const edited = page.getByTestId("image-result").first();
    await expect(edited).toBeVisible();
    record("image-edit", true, `driver ${await servedBy()}`);
  });

  test("a video is made as a job, watched and fetched", async () => {
    await openDoor("video", "videos/acme/grok");
    await page.getByTestId("video-seconds").selectOption("2");
    await page.getByTestId("video-send").click();
    await page.getByTestId("video-send-confirm").click();
    await expect(page.getByTestId("video-status")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("video-result")).toBeVisible({ timeout: 90_000 });
    const status = (await page.getByTestId("video-status").textContent()) ?? "";
    record("video", status === "Finished.", `status ${status}; driver ${await servedBy()}`);
  });

  test("chat hears a recording, reads a PDF, and answers out loud", async () => {
    await page.goto("/playground");
    const picker = page.getByRole("combobox", { name: "Model" });
    await expect(picker).toBeVisible({ timeout: 60_000 });

    await picker.selectOption("media/acme/hears");
    await page
      .getByTestId("attach-input")
      .setInputFiles({ name: "note.wav", mimeType: "audio/wav", buffer: wav() });
    await expect(page.getByTestId("audio-chip")).toBeVisible();
    await page.getByTestId("composer").fill("What do you hear?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("message-audio")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("request-report")).toBeVisible({ timeout: 60_000 });
    const heard = (await page.getByTestId("report-summary").getAttribute("data-status")) ?? "";
    record("chat-audio-in", heard === "200", `status ${heard}`);
    // The recording is in the history now, and a model that cannot hear is
    // rightly never sent it: each step starts its own conversation.
    await newConversation(page);

    await picker.selectOption("media/acme/reads");
    await page
      .getByTestId("attach-input")
      .setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByTestId("pdf-chip")).toBeVisible();
    await page.getByTestId("composer").fill("What does it say?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("message-file").last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("report-summary")).toHaveAttribute("data-status", "200", {
      timeout: 60_000,
    });
    record("chat-pdf", true, "status 200");
    await newConversation(page);

    await picker.selectOption("media/acme/speaks");
    // The panel remembers being open (the direct-mode step opened it).
    const toggle = page.getByTestId("toggle-diagnostic");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await page.getByTestId("spoken-toggle").check();
    await page.getByTestId("composer").fill("Say hello.");
    await page.getByRole("button", { name: "Send" }).click();
    const spoken = page.getByTestId("spoken-reply").last();
    await expect(spoken).toBeVisible({ timeout: 60_000 });
    const src = (await spoken.getAttribute("src")) ?? "";
    record("chat-spoken", src.startsWith("data:audio/"), `src ${src.slice(0, 32)}...`);
    await page.getByTestId("spoken-toggle").uncheck();
  });
});

async function newConversation(page: Page): Promise<void> {
  await page.getByTestId("new-conversation").click();
  await page.getByTestId("new-conversation-confirm").click();
  await expect(page.getByTestId("message-bubble")).toHaveCount(0);
}

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
