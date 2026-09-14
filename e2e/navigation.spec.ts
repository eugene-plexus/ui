/**
 * The navigation, in a browser, against a real install.
 *
 * jsdom has no layout and no computed styles, so it cannot be wrong about
 * the two things this slice is actually made of: that every screen is
 * reachable from every other screen, and that the layer colours and icons
 * are the ones on `https://eugeneplexus.com/architecture`. Those need a
 * browser that has resolved the CSS custom properties, which is this.
 *
 * Runner: `specs/scripts/navigation-acceptance.sh`.
 *
 * **The check that could pass while broken is the reachability one.**
 * Asserting "a link named Metrics exists" would pass against the state
 * this replaced, where the full link row existed on the playground and
 * nowhere else — as long as the test never left the playground. So it is
 * a loop that visits each of the seven screens in turn and asserts from
 * *there*, and every assertion names the screen it was made from.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";

/**
 * Transcribed from `website/src/pages/architecture.astro` at `3b5129c`,
 * independently of `src/lib/navigation.ts` — a test that imported the
 * registry would assert the app agrees with itself.
 *
 * The colours are the **modern** theme's resolved values, which are the
 * website's literals: `--accent-left: #2a55e6`, `--accent-right: #cf3a85`,
 * engines `#2f9e6e`, hardware `#8a8a93`. Modern is the default theme, so
 * this is what a browser with no stored preference renders.
 */
const BLUE = "rgb(42, 85, 230)";
const PINK = "rgb(207, 58, 133)";
const GREEN = "rgb(47, 158, 110)";
const GREY = "rgb(138, 138, 147)";

interface Expected {
  href: string;
  label: string;
  icon: string;
  colour: string;
  layer: string;
}

const SCREENS: Expected[] = [
  { href: "/", label: "Playground", icon: "Terminal", colour: BLUE, layer: "Your tools" },
  { href: "/metrics", label: "Metrics", icon: "Radio", colour: PINK, layer: "Gateway" },
  { href: "/inference", label: "Inference", icon: "Cpu", colour: BLUE, layer: "Inference drivers" },
  { href: "/library", label: "Library", icon: "Database", colour: BLUE, layer: "Library" },
  { href: "/discover", label: "Discover", icon: "FolderOpen", colour: BLUE, layer: "Library" },
  { href: "/config", label: "Config", icon: "Server", colour: BLUE, layer: "Agent" },
  { href: "/nodes", label: "Nodes", icon: "ShieldCheck", colour: PINK, layer: "Control root" },
];

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("app-nav")).toBeVisible({ timeout: 120_000 });
}

/** The nav's link for one screen, named so nothing else can match it. */
function navLink(page: Page, href: string) {
  return page.getByTestId("app-nav").locator(`a[data-nav-screen="${href}"]`);
}

test.describe("the shared navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("every screen is reachable from every screen", async ({ page }) => {
    for (const from of SCREENS) {
      await page.goto(from.href);
      await expect(page.getByTestId("app-nav"), `no navigation on ${from.href}`).toBeVisible();

      // All seven links are present from here. This is the assertion the
      // old UI would have failed from six of the seven screens.
      for (const to of SCREENS) {
        await expect(
          navLink(page, to.href),
          `${from.href} has no link to ${to.href}`,
        ).toBeVisible();
      }

      // And the one for this screen is marked current, on this screen only.
      await expect(navLink(page, from.href), `${from.href} is not marked current`).toHaveAttribute(
        "aria-current",
        "page",
      );
      const marked = await page.getByTestId("app-nav").locator('a[aria-current="page"]').count();
      expect(marked, `${from.href} marks ${marked} links current`).toBe(1);
    }
  });

  test("each link actually navigates to its screen", async ({ page }) => {
    // Start from the screen furthest from everything in the old topology:
    // `/nodes`, whose only exit was Back.
    for (const to of SCREENS) {
      await page.goto("/nodes");
      await navLink(page, to.href).click();
      await expect(
        page.getByTestId("screen-header"),
        `clicking ${to.label} from /nodes did not arrive`,
      ).toHaveAttribute("data-screen", to.href);
      await expect(page.getByRole("heading", { level: 1, name: to.label })).toBeVisible();
    }
  });

  test("sign out is on every screen", async ({ page }) => {
    for (const from of SCREENS) {
      await page.goto(from.href);
      await expect(page.getByTestId("sign-out"), `no sign out on ${from.href}`).toBeVisible();
    }
  });

  test("the icons and colours are the architecture page's", async ({ page }) => {
    await page.goto("/");
    for (const screen of SCREENS) {
      const icon = navLink(page, screen.href).locator("svg");
      await expect(icon, `${screen.label} has no icon`).toHaveAttribute("data-icon", screen.icon);
      const colour = await icon.evaluate((el) => getComputedStyle(el).color);
      expect(colour, `${screen.label}'s icon is ${colour}, not ${screen.colour}`).toBe(
        screen.colour,
      );
    }
  });

  test("each screen says which layer it is in", async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.href);
      const crumb = page.getByTestId("layer-breadcrumb");
      await expect(crumb, `no breadcrumb on ${screen.href}`).toBeVisible();
      await expect(crumb).toContainText(screen.layer);
    }
  });

  test("inference shows all three of its layers, in three colours", async ({ page }) => {
    await page.goto("/inference");
    const crumb = page.getByTestId("layer-breadcrumb");
    for (const name of ["Inference drivers", "Engines and backends", "Your hardware"]) {
      await expect(crumb).toContainText(name);
    }
    // The only live assertion that --accent-engine and --accent-hardware
    // are wired at all: no screen's *home* layer is either of them, so
    // the nav bar never renders them.
    const colours = await crumb
      .locator("span[data-layer]")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(colours, "the three layers are not three colours").toEqual([BLUE, GREEN, GREY]);
  });

  test("the layer map shows the whole system, and Escape closes it", async ({ page }) => {
    await page.goto("/metrics");
    const toggle = page.getByTestId("layer-map-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();

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
    for (const screen of SCREENS) {
      await expect(
        map.locator(`a[data-map-screen="${screen.href}"]`).first(),
        `the map places no ${screen.label}`,
      ).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(map).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("the skip link is the first thing a keyboard reaches", async ({ page }) => {
    await page.goto("/library");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(focused).toContain("Skip to content");
  });
});
