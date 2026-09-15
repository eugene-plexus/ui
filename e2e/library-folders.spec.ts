/**
 * The Library's folders and how each node reaches them, in a browser,
 * against a real two-agent install (2026-09-14).
 *
 * `specs/docs/design/library-folders-and-reach.md` §10.7. The pure model
 * (`lib/libraryReach.ts`, `lib/resourceTree.ts`) carries the shapes; what
 * is left for a browser is that a node appears under Library, that its
 * Folders page reports the inherited mount, and — the principle this
 * slice was stated with — that Browse in the Override box lists THE
 * REMOTE NODE's disk from the console the operator is sitting at. The
 * runner proves the last half from the far agent's own log.
 *
 * Runner: `specs/scripts/library-folders-acceptance.sh`.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
/** The worker node, which declares no library and carries no overrides. */
const NODE_B = process.env.EP_NODE_B ?? "node-b";
/** The folder as the Library spells it. */
const FOLDER = process.env.EP_FOLDER ?? "";
/** Where node B mounts it, as B spells a local path. */
const MOUNT = process.env.EP_MOUNT ?? "";
/** A subdirectory that exists only under B's mount. */
const MARKER = process.env.EP_MARKER ?? "only-on-b";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

const tree = (page: Page) => page.getByTestId("tree-column").getByTestId("resource-tree");
/** A Windows path inside a CSS attribute selector: each backslash is an escape. */
const css = (value: string) => value.replace(/\\/g, "\\\\");

async function loaded(page: Page): Promise<void> {
  await expect(tree(page)).toHaveAttribute("data-ready", "true");
}

test.describe("Library folders and their reach", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("a node sits under Library, and Library's pages include Folders", async ({ page }) => {
    await page.goto("/?sel=library");
    await loaded(page);
    // Nested under the Library row, not hanging off the branch list: the
    // wrapper names its parent, so "under" is assertable.
    const under = tree(page).locator('[data-tree-children="library"]');
    await expect(
      under.locator(`a[data-tree-sel="library:node:${NODE_B}"]`),
      `${NODE_B} is not under Library`,
    ).toBeVisible();
    const ids = await page
      .getByTestId("page-menu")
      .locator("a[data-page]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-page")!));
    expect(ids).toEqual(["models", "folders", "discover", "config"]);
  });

  test("the grid shows every node's column, and the worker's cell is inherited", async ({
    page,
  }) => {
    await page.goto("/library/folders?sel=library");
    const grid = page.getByTestId("folders-grid");
    await expect(grid).toBeVisible();
    await expect(grid.locator(`th[data-node-column="${NODE_B}"]`)).toBeVisible();
    const row = grid.locator(`tr[data-folder="${css(FOLDER)}"]`);
    await expect(row, `no row for the folder ${FOLDER}`).toBeVisible();
    const cell = row.locator(`td[data-node-cell="${NODE_B}"]`);
    await expect(cell).toHaveAttribute("data-tone", "ok", { timeout: 30_000 });
    await expect(cell).toContainText("inherited");
    await expect(cell).toContainText(MOUNT);
    // The mounts the folder itself carries: the Windows box holds B's mount.
    await expect(row.getByTestId("mount-windows")).toHaveValue(MOUNT);
  });

  test("the worker's Folders page reports the inherited mount with no override", async ({
    page,
  }) => {
    await page.goto(`/library/folders?sel=library:node:${NODE_B}`);
    const table = page.getByTestId("folders-node");
    await expect(table).toBeVisible();
    const row = table.locator(`tr[data-folder="${css(FOLDER)}"]`);
    await expect(row).toHaveAttribute("data-tone", "ok", { timeout: 30_000 });
    await expect(row.getByTestId("node-local-path")).toContainText(MOUNT);
    await expect(row.getByTestId("node-source")).toContainText("inherited");
    await expect(row.getByTestId("override-input")).toHaveValue("");
    // The tree agrees about what is selected.
    await expect(page.getByTestId("page-menu")).toHaveAttribute(
      "data-sel",
      `library:node:${NODE_B}`,
    );
  });

  test("Browse in the Override box lists the remote node's disk, and the override round-trips", async ({
    page,
  }) => {
    await page.goto(`/library/folders?sel=library:node:${NODE_B}`);
    const row = page.getByTestId("folders-node").locator(`tr[data-folder="${css(FOLDER)}"]`);
    await expect(row).toHaveAttribute("data-tone", "ok", { timeout: 30_000 });

    await row.getByTestId("override-browse").click();
    const dialog = page.getByRole("dialog", { name: "Choose a directory" });
    await expect(dialog).toBeVisible();
    // Walk to B's mount by path and see the subdirectory that exists only
    // there. That the listing came from B's agent, not this console's, is
    // proved by the runner from B's own access log.
    await dialog.getByLabel("Path").fill(MOUNT);
    await dialog.getByRole("button", { name: "go" }).click();
    await expect(dialog, `${MARKER} is not in the listing of ${MOUNT}`).toContainText(MARKER);
    await dialog.getByRole("button", { name: "use this folder" }).click();
    await expect(row.getByTestId("override-input")).toHaveValue(MOUNT);

    // Test checks the unsaved override on B; Save writes it; the page
    // then says the rule that applies is the override.
    await page.getByTestId("overrides-test").click();
    await expect(page.getByText(/Checked on/)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("overrides-save").click();
    await expect(page.getByText(/Overrides saved/)).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId("node-source")).toContainText("override", { timeout: 30_000 });

    // And back: clearing the override returns the node to the folder's mount.
    await row.getByRole("button", { name: "clear" }).click();
    await page.getByTestId("overrides-save").click();
    await expect(page.getByText(/Overrides saved/)).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId("node-source")).toContainText("inherited", { timeout: 30_000 });
  });

  test("the agent's own Config names the field as overrides under Library", async ({ page }) => {
    await page.goto(`/config/?sel=agent:${NODE_B}`);
    await expect(page.getByText("Library folder overrides")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/No overrides\./)).toBeVisible();
  });
});
