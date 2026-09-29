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
 * driver first so the deepest path in the tree has something in it. How
 * deep that is depends on the install: the machine level renders only
 * once there is more than one machine (hobbyist-ux.md §6.4), so on the
 * runner's one box the path is type → driver, and the tests here read
 * the registry to know which shape to hold the tree to.
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

/**
 * How many machines the install has, from the registry and not from the
 * tree — a test that counted the tree's own rows to decide what the tree
 * should show would pass a tree that collapsed two machines into one.
 *
 * An unenrolled box has no registry to ask (no root, or `503 Locked`)
 * and is one machine. The runner declares its driver on this machine, so
 * the one way a machine can exist outside the registry — a driver naming
 * one — does not arise here.
 */
async function machineCount(page: Page): Promise<number> {
  const token = await page.evaluate(() => sessionStorage.getItem("eugene-session-token"));
  const res = await page.request.get("/api/proxy/control/v1/nodes", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return 1;
  const body = (await res.json()) as { nodes?: unknown[] };
  return Math.max(1, body.nodes?.length ?? 0);
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
    // The four branches, in the order of a hobbyist's questions
    // (ui-settings-reorganisation.md, decision #5).
    for (const branch of ["Library", "Backends", "Gateway", "Machines"]) {
      await expect(t, `the tree has no ${branch}`).toContainText(branch);
    }
    // The implementation nouns left the labels for hover text.
    for (const noun of ["Inference drivers", "Control root", "Agents"]) {
      await expect(t, `${noun} is still a visible label`).not.toContainText(noun);
    }
    // Machines lists one row per machine, on a one-box install too: the
    // leaf carries the `agent` token the Config page always used.
    const machines = t.locator('a[data-tree-sel^="agent"]');
    await expect(machines, "one leaf per machine under Machines").toHaveCount(
      await machineCount(page),
    );
    await expect(
      t.locator('[data-tree-children="control"]').locator('a[data-tree-sel^="agent"]').first(),
      "the machine leaf is not under Machines",
    ).toBeVisible();
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
      ["install", ["home", "playground", "apps", "logs", "config"]],
      ["library", ["models", "discover", "folders", "config"]],
      ["backends", ["overview", "add"]],
      ["control", ["overview", "config"]],
      ["gateway", ["metrics", "routing", "config"]],
    ];
    for (const [sel, pages] of cases) {
      await page.goto(`/?sel=${sel}`);
      const menu = page.getByTestId("page-menu");
      // The shell renders after the setup gate answers, and `goto` returns
      // at the load event, which the gate's fetch can outlive. Reading the
      // menu the instant the page loaded returned [] once Home carried more
      // script than the playground did (S1's first navigation run); wait
      // for the first entry, then read the list.
      await expect(menu.locator("a[data-page]").first()).toBeVisible({ timeout: 60_000 });
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

  test("a backend sits under its machine once there are two, straight under Backends with one, and opens its own row", async ({
    page,
  }) => {
    await page.goto("/");
    await loaded(page);
    const leaf = tree(page).locator(`a[data-tree-sel^="driver:${DRIVER}"]`);
    await expect(leaf, `no ${DRIVER} leaf in the tree`).toBeVisible();
    const sel = await leaf.getAttribute("data-tree-sel");

    if ((await machineCount(page)) > 1) {
      // **It is under a machine, not hanging off the type.** The first
      // version of this test asserted only that the leaf existed, and so
      // passed against a tree with the node level removed entirely — a
      // check that did not test the thing its name claims. The node group
      // is the row whose `sel` the leaf's own `sel` names after the `@`,
      // and since 2026-09-29 the group is selectable, keyed by its token.
      const node = sel!.slice(sel!.lastIndexOf("@") + 1);
      expect(node, "the driver's sel carries no machine").toBeTruthy();
      const group = tree(page).locator(`[data-tree-children="backends:node:${node}"]`);
      await expect(
        group.locator(`a[data-tree-sel="${sel}"]`),
        `${DRIVER} is not nested under ${node}`,
      ).toBeVisible();
    } else {
      // **One machine: no node level, by design** (hobbyist-ux.md §6.4).
      // The leaf is a direct child of the Backends branch — the wrapper
      // names the branch, and a nested leaf would sit two rows deeper —
      // and no group row exists anywhere in the tree. A leaf that merely
      // exists would pass either shape, which is the check this replaced.
      const branch = tree(page).locator('[data-tree-children="backends"]');
      await expect(
        branch.locator(`:scope > div > div > a[data-tree-sel="${sel}"]`),
        `${DRIVER} is not a direct child of Backends`,
      ).toBeVisible();
      await expect(
        tree(page).locator('a[data-tree-sel^="backends:node"]'),
        "a machine group rendered on a one-machine install",
      ).toHaveCount(0);
    }

    // The leaf's first page is its Overview: the Backends page opened on
    // this backend, its row marked, with start/stop on it. Troy's report
    // was that the leaf held only config while the actions were on the
    // install root.
    await leaf.click();
    await expect(page).toHaveURL(/\/inference/);
    await expect(page.getByTestId("inference-scope")).toContainText(DRIVER);
    // The row arrives once the gateway's routing refresh has seen the
    // driver, which is its own cadence, not the page's.
    await expect(page.locator(`tr[data-driver="${DRIVER}"]`)).toHaveAttribute(
      "data-marked",
      "true",
      { timeout: 60_000 },
    );
    // And its Settings is one menu entry away, addressing this backend.
    await page.getByTestId("page-menu").locator('a[data-page="config"]').click();
    await expect(page).toHaveURL(/\/config/);
    // The editor is addressing this driver, not a component that merely
    // shares a page with it.
    await expect(page.getByTestId("page-menu")).toContainText(DRIVER);
  });

  test("a bare /config is every setting on the install, by topic, with a search box", async ({
    page,
  }) => {
    // Since 2026-09-29 (ui-settings-reorganisation.md). It used to be
    // this machine's agent, and the defect this test guarded -- a page
    // opening with nothing selected -- is guarded the same way: the menu
    // and the tree agree on the install root.
    await page.goto("/config/");
    await loaded(page);
    const menu = page.getByTestId("page-menu");
    await expect(menu).toHaveAttribute("data-sel", "install");
    await expect(row(page, "install")).toHaveAttribute("aria-current", "page");
    await expect(menu.locator('a[data-page="config"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("settings-search")).toBeVisible();
    // The gateway's, the library's and this machine's settings, on one
    // page, filed by topic rather than by process.
    const cards = page.getByTestId("settings-card");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    for (const topic of ["models", "answers", "serving", "engines", "access"]) {
      await expect(
        page.locator(`[data-testid="settings-card"][data-topic="${topic}"]`),
        `no ${topic} card`,
      ).toBeVisible({ timeout: 30_000 });
    }
    // A search shrinks the page to the answer, and a field behind Show
    // more is opened for the person who searched for it.
    await page.getByTestId("settings-search").fill("catalogue token");
    await expect(page.locator('[data-testid="settings-card"][data-topic="models"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-card"][data-topic="access"]')).toHaveCount(0);
    await expect(page.locator('[data-config-key="hfToken"]')).toBeVisible();
  });

  test("a machine's own Settings is that machine's share of the same page", async ({ page }) => {
    await page.goto("/");
    await loaded(page);
    const leaf = tree(page).locator('a[data-tree-sel^="agent"]').first();
    const sel = await leaf.getAttribute("data-tree-sel");
    await leaf.click();
    await expect(page).toHaveURL(/\/config/);
    await expect(page.getByTestId("page-menu")).toHaveAttribute("data-sel", sel!);
    await expect(page.getByTestId("settings-scope")).toContainText(/only/);
    // Its engines and updates, and nothing of the gateway's.
    await expect(page.locator('[data-testid="settings-card"][data-topic="engines"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="settings-card"][data-topic="answers"]')).toHaveCount(
      0,
    );
    // The dead knobs are shown nowhere: no Theme on a machine's page.
    await expect(page.getByLabel("Theme")).toHaveCount(0);
    await expect(page.getByLabel("First-run setup complete")).toHaveCount(0);
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
    // The literals below are the modern theme's, which is the website's
    // palette; the default theme has been plexus (apricot on the right
    // roles) since 2026-09-17, so the check chooses modern first. Found
    // failing on 2026-09-29's run: it had been asserting the default.
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("eugene-theme", "modern"));
    await page.reload();
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
