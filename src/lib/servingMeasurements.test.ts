import { describe, expect, it, vi } from "vitest";
import { readServingMeasurements } from "./servingMeasurements";
import { tasksFrom } from "./tasks";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./api", () => ({ api: mocks }));

describe("serving measurement discovery", () => {
  it("revokes a standalone node's key on the same agent that reported it", async () => {
    const job = { id: "standalone", node: "my-desktop", state: "completed", keyLive: true };
    mocks.get.mockImplementation((target: string, path: string) =>
      Promise.resolve(path === "/v1/nodes" ? { nodes: [] } : { measurements: [job] }),
    );
    mocks.post.mockResolvedValue({ ...job, keyLive: false });
    await readServingMeasurements();
    expect(mocks.post).toHaveBeenCalledWith(
      "agent",
      "/v1/serving-measurements/standalone/cancel",
      {},
    );
  });
  it("finds remote jobs and retries a finished live key through its own node", async () => {
    const job = {
      id: "j",
      runtime: "r",
      node: "studio",
      model: "m",
      state: "completed",
      keyLive: true,
    };
    mocks.get.mockImplementation((target: string, path: string) =>
      Promise.resolve(
        path === "/v1/nodes"
          ? { nodes: [{ name: "studio" }] }
          : { measurements: target === "agent" ? [] : [job] },
      ),
    );
    mocks.post.mockResolvedValue({ ...job, keyLive: false });
    const jobs = await readServingMeasurements();
    expect(jobs[0]?.keyLive).toBe(false);
    expect(mocks.post).toHaveBeenCalledWith("node:studio", "/v1/serving-measurements/j/cancel", {});
  });
  it("puts a discovered measurement in the task tray", () => {
    const tasks = tasksFrom({
      downloads: null,
      scan: null,
      runtimes: null,
      localRuntimes: null,
      installs: null,
      measurements: [
        {
          id: "j",
          node: "tower",
          runtime: "r",
          model: "m",
          state: "running",
          detail: "8 people: 3 of 5 minutes.",
          progress: 0.6,
        } as never,
      ],
    });
    expect(tasks[0]).toMatchObject({
      kind: "measurement",
      detail: "8 people: 3 of 5 minutes.",
      href: "/inference?measurement=j&node=tower",
    });
  });
});
