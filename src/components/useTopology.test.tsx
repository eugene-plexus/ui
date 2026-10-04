/**
 * The tree's topology keeps up with the install.
 *
 * It was read once, when the shell mounted. A control root that was
 * still coming up at sign-in left the tree saying "control root
 * unreachable", without the other machines, for as long as the page
 * stayed open -- beside a badge that had long since cleared.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useTopology } from "./ResourceTree";

let rootUp: boolean;

beforeEach(() => {
  rootUp = false;
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (route === "agent/v1/components") return json({ components: [] });
      if (route === "agent/v1/node") return json({ enrolled: true, name: "box" });
      if (!rootUp) return json({ detail: "starting" }, 503);
      if (route === "control/v1/components") return json({ components: [] });
      if (route === "control/v1/nodes") return json({ nodes: [{ name: "box" }, { name: "gpu" }] });
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function Probe() {
  const { topology, ready } = useTopology();
  return (
    <p data-testid="topology">
      {ready
        ? `${topology.rootUnreachable ? "unreachable" : "up"} ${topology.nodes.join(",")}`
        : ""}
    </p>
  );
}

it("asks again, so a root that came up later appears without leaving the page", async () => {
  render(<Probe />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByTestId("topology")).toHaveTextContent("unreachable");
  rootUp = true;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByTestId("topology")).toHaveTextContent("up box,gpu");
});
