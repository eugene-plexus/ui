import { describe, expect, it } from "vitest";

import { BRAND, pageTitle } from "./pageTitle";

/**
 * The composition rules. The *wiring* — which page name and which node
 * the shell actually hands this — is in `AppShell.title.test.tsx`, and it
 * is the half that can be wrong while every case here passes.
 */
describe("pageTitle", () => {
  it("names the page, then the brand, on a one-machine install", () => {
    expect(pageTitle({ page: "Discover", node: "Amish_Station", machines: 1 })).toBe(
      "Discover · Eugene Plexus",
    );
  });

  it("names the machine as well once there is more than one", () => {
    expect(pageTitle({ page: "Config", node: "Amish_Station", machines: 2 })).toBe(
      "Config · Amish_Station · Eugene Plexus",
    );
  });

  it("puts the page first, because a tab is truncated from the right", () => {
    // The whole reason the order is not object-then-page like the tree:
    // two tabs of Config on two machines have to be distinguishable at
    // whatever width the browser gives them.
    const title = pageTitle({ page: "Config", node: "nas", machines: 2 });
    expect(title.indexOf("Config")).toBe(0);
    expect(title.indexOf("nas")).toBeLessThan(title.indexOf(BRAND));
  });

  it("drops the page rather than inventing a name for it, and keeps the machine", () => {
    // A page nothing can name is the first frames of a load, or a route
    // in neither registry. A guess would name the wrong screen in a
    // bookmark -- but the machine is still known and still the thing that
    // tells two tabs apart, so it stays.
    expect(pageTitle({ page: null, node: "nas", machines: 3 })).toBe("nas · Eugene Plexus");
    expect(pageTitle({ page: "", node: null, machines: 1 })).toBe("Eugene Plexus");
  });

  it("drops a machine it was given nothing for", () => {
    // An unenrolled box has no name, and `Discover ·  · Eugene Plexus`
    // is worse than no name at all.
    expect(pageTitle({ page: "Home", node: null, machines: 2 })).toBe("Home · Eugene Plexus");
    expect(pageTitle({ page: "Home", node: "   ", machines: 2 })).toBe("Home · Eugene Plexus");
  });

  it("always ends in the brand, which is the static title in layout.tsx", () => {
    // The export prerenders `layout.tsx`'s literal, so the pre-hydration
    // tab and this one have to agree about what the app is called.
    for (const machines of [1, 2]) {
      for (const page of [null, "Home", "Folders"]) {
        expect(pageTitle({ page, node: "nas", machines })).toMatch(/Eugene Plexus$/);
      }
    }
  });
});
