/** ui#20: "Leave the install" for the machine this console runs on. */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeaveInstall } from "./LeaveInstall";

let identity: Record<string, unknown>;
let posted: { url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  identity = { enrolled: true, name: "gpu-box", controlUrl: "http://10.0.0.1:8083" };
  posted = [];
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "the-installs-session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/proxy/agent/v1/node")) return json(identity);
      if (url.endsWith("/api/proxy/agent/v1/node/unenroll")) {
        posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return json({
          identity: { enrolled: false },
          controlNotified: true,
          previousName: "gpu-box",
          previousControlUrl: "http://10.0.0.1:8083",
        });
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Leave the install", () => {
  it("asks first, leaves with the session, and ends it here", async () => {
    render(<LeaveInstall rootName="nas" />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave the install" }));
    expect(screen.getByTestId("leave-install-prompt")).toHaveTextContent(
      "works on its own. Sessions on it end",
    );
    expect(posted).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Leave and work on its own" }));
    expect(
      await screen.findByText(/This machine left the install at http:\/\/10\.0\.0\.1:8083/),
    ).toBeInTheDocument();
    expect(posted).toEqual([{ url: expect.stringMatching(/\/v1\/node\/unenroll$/), body: {} }]);
    expect(sessionStorage.getItem("eugene-session-token")).toBeNull();
  });

  it("is not offered on the root's own machine", async () => {
    render(<LeaveInstall rootName="gpu-box" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Leave the install" })).toBeNull();
  });

  it("is not offered on a machine that has joined nothing", async () => {
    identity = { enrolled: false };
    render(<LeaveInstall />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Leave the install" })).toBeNull();
  });
});
