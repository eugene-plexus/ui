import { describe, expect, it } from "vitest";

import { describeControlRoot } from "./controlRoot";
import type { ControlRootView } from "./types";

/**
 * Bodies as the gateway sends them: pydantic renders the URL with a
 * trailing slash and `error` as `null`, neither of which the generated
 * type spells out. Parsed from JSON so the test meets the wire shape.
 */
function body(json: string): ControlRootView {
  return JSON.parse(json) as ControlRootView;
}

describe("describeControlRoot", () => {
  it("says the root was found through the agent, and how many nodes it listed", () => {
    const line = describeControlRoot(
      body(
        '{"source":"agent","url":"http://127.0.0.1:8183/","reachable":true,"error":null,"nodes":2}',
      ),
    );
    expect(line).not.toBeNull();
    expect(line?.tone).toBe("muted");
    expect(line?.text).toBe(
      "Control root http://127.0.0.1:8183 · found through this node's agent · 2 nodes",
    );
    expect(line?.detail).toBeNull();
  });

  it("says when the operator set it, and counts one node in the singular", () => {
    const line = describeControlRoot(
      body(
        '{"source":"config","url":"http://192.168.16.252:8283","reachable":true,"error":null,"nodes":1}',
      ),
    );
    expect(line?.text).toBe("Control root http://192.168.16.252:8283 · set under Config · 1 node");
  });

  it("warns when the root did not answer, names the reason, and keeps the last count", () => {
    const line = describeControlRoot(
      body(
        '{"source":"agent","url":"http://127.0.0.1:8083/","reachable":false,"error":"503 Locked","nodes":2}',
      ),
    );
    expect(line?.tone).toBe("warn");
    expect(line?.text).toBe(
      "Control root http://127.0.0.1:8083 did not answer on the gateway's last refresh (503 Locked): showing the last node list it had · 2 nodes.",
    );
    // A sealed root has a specific remedy, and the line says it.
    expect(line?.detail).toContain("Nodes page");
    expect(line?.detail).toContain("passphrase file");
  });

  it("explains a plain outage without the sealed-root remedy", () => {
    const line = describeControlRoot(
      body(
        '{"source":"config","url":"http://nowhere:1","reachable":false,"error":"HTTP 404","nodes":null}',
      ),
    );
    expect(line?.tone).toBe("warn");
    expect(line?.text).toBe(
      "Control root http://nowhere:1 did not answer on the gateway's last refresh (HTTP 404): showing the last node list it had.",
    );
    expect(line?.detail).toContain("set under Config");
    expect(line?.detail).not.toContain("Nodes page");
  });

  it("says when there is no control root at all", () => {
    const line = describeControlRoot(
      body('{"source":"none","url":null,"reachable":false,"error":null,"nodes":null}'),
    );
    expect(line?.tone).toBe("muted");
    expect(line?.text).toMatch(/^No control root/);
    expect(line?.detail).toContain("Config");
  });

  it("says nothing for a gateway older than the field", () => {
    expect(describeControlRoot(undefined)).toBeNull();
    expect(describeControlRoot(null)).toBeNull();
  });
});
