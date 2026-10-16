/** Browser navigation/layout coverage with isolated API fixtures, not an engine/GPU test. */
import { expect, test } from "@playwright/test";

test.skip(process.env.EP_HANDOFF_FIXTURE !== "1", "opt-in isolated handoff fixture");

for (const destination of ["PC", "NAS"]) {
  test(`download only, return through Tasks, then run on ${destination}`, async ({
    page,
  }, info) => {
    const repo = "example/Small-Chat";
    const file = "small-Q4_K_M.gguf";
    const model = {
      id: "library-file",
      name: "Small Chat",
      path: `/models/${file}`,
      format: "gguf",
      status: "present",
      capabilities: { chat: true },
    };
    const download = {
      id: "transfer-1",
      repo,
      revision: "commit-123",
      state: "done",
      modelId: model.id,
      finishedAt: new Date().toISOString(),
      bytesTotal: 1000,
      bytesDownloaded: 1000,
      files: [
        {
          path: file,
          destinationPath: model.path,
          bytesDownloaded: 1000,
          sizeBytes: 1000,
          state: "done",
        },
      ],
    };
    let downloaded = false;
    let catalogueAvailable = true;
    const operations: Record<string, unknown>[] = [];
    const launches: Record<string, unknown>[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((node) => {
      sessionStorage.setItem("eugene-session-token", "fixture-token");
      if (!localStorage.getItem("eugene-plexus.targetNode"))
        localStorage.setItem("eugene-plexus.targetNode", node);
    }, destination);
    await page.route("**/api/proxy/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.split("/v1/")[1] ?? "";
      const method = route.request().method();
      let body: unknown = {};
      if (path === "node") body = { name: "PC", enrolled: true, devices: [] };
      else if (path === "nodes")
        body = {
          nodes: [
            { name: "PC", reachable: true, devices: [] },
            { name: "NAS", reachable: true, devices: [] },
          ],
        };
      else if (path === "components") body = { components: [{ kind: "library", name: "library" }] };
      else if (path === "apps")
        body = {
          apps: [
            {
              id: "workbench",
              name: "Workbench",
              enabled: true,
              ui: true,
              uiUrl: "https://workbench.example/",
            },
          ],
        };
      else if (path === "run-operations") body = { operations };
      else if (path.startsWith("run-operations/") && method === "PUT") {
        const intent = route.request().postDataJSON();
        launches.push(intent);
        body = {
          id: path.split("/")[1],
          intent,
          node: intent.node,
          step: "ready",
          model,
          runtime: "small-chat",
          runtimeStatus: "ready",
          engine: "llama_cpp",
          startedAt: Date.now(),
          finishedAt: Date.now(),
        };
        operations.push(body as Record<string, unknown>);
      } else if (path === "downloads") {
        if (method === "POST") {
          downloaded = true;
          body = download;
        } else body = { downloads: downloaded ? [download] : [] };
      } else if (path === "models/library-file") body = model;
      else if (path.startsWith("runtimes/"))
        body = {
          name: "small-chat",
          driver: "small-driver",
          modelAlias: "small-served",
          status: "ready",
          mode: "chat",
        };
      else if (path === "runtimes") body = { runtimes: [] };
      else if (path === "engines")
        body = { engines: [{ engine: "llama_cpp", available: true, accepts: [] }] };
      else if (path === "catalogue/search") body = { results: [] };
      else if (path === "catalogue/model") {
        if (!catalogueAvailable) {
          await route.fulfill({ status: 503, json: { detail: "Catalogue unavailable" } });
          return;
        }
        body = {
          repo,
          name: "Small Chat",
          owner: "example",
          resolvedCommit: "commit-123",
          recommended: { label: "Q4_K_M", reason: "Fits this machine." },
          candidates: [
            {
              label: "Q4_K_M",
              format: "gguf",
              sizeBytes: 1000,
              files: [{ path: file, sizeBytes: 1000, role: "weights" }],
              fit: { verdict: "fits", contextLength: 8192, basis: "estimate", notes: [] },
            },
          ],
          projectors: [],
          otherFiles: [],
          warnings: [],
        };
      } else if (path === "catalogue/card") {
        await route.fulfill({ status: 404, json: { detail: "No card" } });
        return;
      } else if (path === "models/eligibility") body = { models: [] };
      else if (path === "scan") body = { state: "done" };
      await route.fulfill({ json: body });
    });
    await page.goto(`/discover?repo=${encodeURIComponent(repo)}`);
    const card = page.getByTestId("repo-recommended");
    await expect(card.getByRole("button", { name: /Download and run/ })).toBeEnabled();
    await card.getByRole("button", { name: /^Download only/ }).click();
    const runName = destination === "PC" ? "Run" : "Run on NAS";
    await expect(card.getByRole("button", { name: runName, exact: true })).toBeEnabled();
    expect(launches).toEqual([]);
    // A later browsing preference must not change this transfer's destination.
    await page.evaluate(() => localStorage.setItem("eugene-plexus.targetNode", "PC"));
    catalogueAvailable = false;
    await page.goto("/discover?repo=example%2FOther");
    await page.getByRole("button", { name: /^Tasks/ }).click();
    await page
      .getByTestId("tasks-popover")
      .getByRole("link", { name: /Downloaded example\/Small-Chat/ })
      .click();
    const continuation = page.getByRole("region", { name: "Selected download" });
    await expect(continuation.getByRole("button", { name: runName, exact: true })).toBeEnabled();
    await page.reload();
    await continuation.getByRole("button", { name: runName, exact: true }).click();
    await expect(continuation.getByRole("link", { name: "Open in Workbench" })).toHaveAttribute(
      "href",
      "https://workbench.example/?model=small-served",
    );
    expect(launches).toEqual([{ node: destination, modelId: model.id }]);
    await expect(continuation.getByRole("link", { name: "Open in Workbench" })).toBeInViewport();
    await expect(
      continuation.getByRole("link", { name: "View model and hardware details" }),
    ).toHaveAttribute("href", `/inference/?sel=driver%3Asmall-driver%40${destination}`);
    await page.screenshot({ path: info.outputPath(`handoff-${destination}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(continuation.getByRole("link", { name: "Open in Workbench" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
