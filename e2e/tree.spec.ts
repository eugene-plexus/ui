/**
 * The resource tree, in a browser, against a real install.
 *
 * `specs/docs/design/ui-tree-navigation.md`. The model in
 * `lib/resourceTree.ts` is pure and carries the shapes — including the
 * sealed-root one, which nobody can produce on demand — so what is left
 * for a browser is the two things jsdom cannot be right about: that
 * every object is actually reachable and selects, and that the layer
 * colours resolve to the website's.
 *
 * Runner: `specs/scripts/navigation-acceptance.sh`, which declares a
 * driver first so the deepest path in the tree (type → node → driver)
 * has something in it.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
/** The driver the runner declares. */
const DRIVER = process.env.EP_DRIVER_NAME ?? "tree-probe";

/** Modern-theme values, which are the website's literals. */
const BLUE = "rgb(42, 85, 230)";
const PINK = "rgb(207, 58, 133)";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

/**
 * The column instance, not the drawer: both render a `resource-tree`,
 * and at desk width the drawer is absent while at phone width the column
 * is hidden. Naming which one is the subject is the fix for the recurring
 * defect in this repo where a locator matched something adjacent to what
 * the assertion was about.
 */
const tree = (page: Page) => page.getByTestId("tree-column").getByTestId("resource-tree");
const drawer = (page: Page) => page.getByTestId("tree-drawer").getByTestId("resource-tree");
const row = (page: Page, sel: string) => tree(page).locator(`a[data-tree-sel="${sel}"]`);

/**
 * Wait for the topology to have arrived.
 *
 * Before it does, the tree is what an empty topology produces — an
 * install root and one agent — which is a legitimate intermediate state
 * and not what any of these assertions are about. The first run of this
 * spec read that state and reported "the tree offered nothing to click".
 */
async function loaded(page: Page): Promise<void> {
  await expect(tree(page)).toHaveAttribute("data-ready", "true");
}

test.describe("the resource tree", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("shows the install and its five branches", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    const t = tree(page);
    await expect(t).toContainText("Eugene Plexus");
    for (const branch of ["Gateway", "Inference drivers", "Agents", "Library", "Control root"]) {
      await expect(t, `the tree has no ${branch}`).toContainText(branch);
    }
  });

  test("every object in the tree selects and arrives", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    // Whatever the topology is, walk what is actually there rather than
    // a list written here — a list would pass against a tree missing
    // exactly the rows this is meant to catch.
    const sels = await tree(page)
      .locator("a[data-tree-sel]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-tree-sel")!));
    expect(sels.length, "the tree offered nothing to click").toBeGreaterThan(4);

    for (const sel of sels) {
      await page.goto("/");
      await loaded(page);
      await row(page, sel).click();
      await expect(
        page.getByTestId("page-menu"),
        `selecting ${sel} produced no page menu`,
      ).toHaveAttribute("data-sel", sel);
      await expect(
        row(page, sel),
        `${sel} is not marked current after selecting it`,
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("the page menu lists the pages each object owns", async ({ page }) => {
    const cases: [string, string[]][] = [
      ["install", ["playground", "inference", "preferences"]],
      ["library", ["models", "folders", "discover", "config"]],
      ["control", ["nodes", "config"]],
      ["gateway", ["metrics", "config"]],
    ];
    for (const [sel, pages] of cases) {
      await page.goto(`/?sel=${sel}`);
      const menu = page.getByTestId("page-menu");
      const ids = await menu
        .locator("a[data-page]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-page")!));
      expect(ids, `${sel}'s pages`).toEqual(pages);
    }
  });

  test("moving between one object's pages keeps that object selected", async ({ page }) => {
    await page.goto("/?sel=library");
    await page.getByTestId("page-menu").locator('a[data-page="discover"]').click();
    await expect(page).toHaveURL(/\/discover/);
    await expect(page.getByTestId("page-menu")).toHaveAttribute("data-sel", "library");
    await expect(row(page, "library")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("page-menu").locator('a[data-page="discover"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a driver sits under its machine and opens its own settings", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    const leaf = tree(page).locator(`a[data-tree-sel^="driver:${DRIVER}"]`);
    await expect(leaf, `no ${DRIVER} leaf in the tree`).toBeVisible();

    // **It is under a machine, not hanging off the type.** The first
    // version of this test asserted only that the leaf existed, and so
    // passed against a tree with the node level removed entirely — a
    // check that did not test the thing its name claims. The node group
    // is the row whose `sel` the leaf's own `sel` names after the `@`.
    const sel = await leaf.getAttribute("data-tree-sel");
    const node = sel!.slice(sel!.lastIndexOf("@") + 1);
    expect(node, "the driver's sel carries no machine").toBeTruthy();
    const group = tree(page).locator(`[data-tree-children$="/nodeGroup:${node}"]`);
    await expect(
      group.locator(`a[data-tree-sel="${sel}"]`),
      `${DRIVER} is not nested under ${node}`,
    ).toBeVisible();

    await leaf.click();
    await expect(page).toHaveURL(/\/config/);
    // The editor is addressing this driver, not a component that merely
    // shares a page with it.
    await expect(page.getByTestId("page-menu")).toContainText(DRIVER);
  });

  test("a bare /config lands on this machine's agent", async ({ page }) => {
    // `defaultSelectionFor` gives the bare token `agent`; on an enrolled
    // node the tree's row is `agent:<name>`, and resolving one to the
    // other is what keeps the page from opening with nothing selected.
    await page.goto("/config/");
    await loaded(page);
    const menu = page.getByTestId("page-menu");
    const sel = await menu.getAttribute("data-sel");
    expect(sel, "a bare /config selected nothing").toMatch(/^agent/);
    await expect(tree(page).locator(`a[data-tree-sel="${sel}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(menu.locator('a[data-page="config"]')).toBeVisible();
  });

  test("a legacy ?tab= link still lands on its subject", async ({ page }) => {
    // The launch panel's "map it" writes this, and it is in builds that
    // are already installed.
    await page.goto("/config/?tab=gateway");
    await loaded(page);
    await expect(page.getByTestId("page-menu")).toHaveAttribute("data-sel", "gateway");
    await expect(row(page, "gateway")).toHaveAttribute("aria-current", "page");
  });

  test("the layer colours are still the architecture page's", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    const colourOf = (sel: string) =>
      row(page, sel)
        .locator("svg")
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    // Pink for the install-wide singletons the site draws pink, blue for
    // the rest. The icons carry the identity; this is the echo.
    expect(await colourOf("gateway"), "gateway").toBe(PINK);
    expect(await colourOf("control"), "control root").toBe(PINK);
    expect(await colourOf("library"), "library").toBe(BLUE);
  });

  test("sign out is reachable from every page", async ({ page }) => {
    for (const url of ["/", "/library/", "/metrics/", "/nodes/", "/config/", "/inference/"]) {
      await page.goto(url);
      await expect(page.getByTestId("sign-out"), `no sign out on ${url}`).toBeVisible();
    }
  });

  test("the tree is a drawer on a phone, and a tap outside closes it", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await page.goto("/library/");
    await expect(page.getByTestId("tree-drawer")).toHaveCount(0);
    await page.getByTestId("tree-drawer-toggle").click();
    await expect(drawer(page)).toBeVisible();
    // A position, not the element centre: the backdrop spans the row and
    // the drawer covers its middle, so a centre click lands on the drawer
    // and is intercepted. This is where a thumb would actually go.
    await page
      .getByRole("button", { name: "Close the install tree" })
      .click({ position: { x: 380, y: 300 } });
    await expect(page.getByTestId("tree-drawer")).toHaveCount(0);
  });

  test("the layer map still explains all eight layers", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    await page.getByTestId("layer-map-toggle").click();
    const map = page.getByTestId("layer-map");
    await expect(map).toBeVisible();
    for (const layer of [
      "Your tools",
      "Gateway",
      "Inference drivers",
      "Engines and backends",
      "Your hardware",
      "Agent",
      "Library",
      "Control root",
    ]) {
      await expect(map, `the map omits ${layer}`).toContainText(layer);
    }
    await page.keyboard.press("Escape");
    await expect(map).toBeHidden();
  });
});
