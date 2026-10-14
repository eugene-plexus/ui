/**
 * Which running models still hold a file the folders no longer name, from
 * `GET /v1/runtimes` as the agent answers it (2026-09-27).
 */

import { describe, expect, it } from "vitest";

import { restartLabel, savedMessage, staleOn, unreadFolders } from "./stalePaths";
import type { LibraryFolderReach, Runtime } from "./types";

const AMISH = { name: "Amish_Station", label: "Amish_Station", target: "node:Amish_Station" };

function runtime(name: string, fields: Partial<Runtime>): Runtime {
  return {
    name,
    engine: "llama_cpp",
    modelPath: "/models/q.gguf",
    status: "ready",
    ...fields,
  } as Runtime;
}

function reach(consulted: boolean): LibraryFolderReach {
  return { libraryConsulted: consulted, folders: [] };
}

describe("staleOn", () => {
  it("names a running model whose next start opens another file", () => {
    const stale = staleOn(AMISH, [
      runtime("qwen", {
        openedPath: "Y:\\models\\q.gguf",
        localPath: "\\\\192.168.16.252\\downloads\\models\\q.gguf",
      }),
    ]);
    expect(stale).toEqual([
      {
        node: "Amish_Station",
        nodeLabel: "Amish_Station",
        target: "node:Amish_Station",
        runtime: "qwen",
        opened: "Y:\\models\\q.gguf",
        next: "\\\\192.168.16.252\\downloads\\models\\q.gguf",
      },
    ]);
  });

  it("leaves out a model already on the file it would open", () => {
    expect(
      staleOn(AMISH, [
        runtime("qwen", { openedPath: "Y:\\m\\q.gguf", localPath: "Y:\\m\\q.gguf" }),
      ]),
    ).toEqual([]);
  });

  it("leaves out a model that is not running, whatever its next start opens", () => {
    // The agent sends openedPath null for stopped, exited, crashed and copying.
    expect(
      staleOn(AMISH, [
        runtime("qwen", { status: "stopped", openedPath: null, localPath: "\\\\NAS\\m\\q.gguf" }),
      ]),
    ).toEqual([]);
  });

  it("reads an agent from before openedPath as nothing to restart, not everything", () => {
    expect(staleOn(AMISH, [runtime("qwen", { localPath: "\\\\NAS\\m\\q.gguf" })])).toEqual([]);
  });
});

describe("savedMessage", () => {
  it("says every machine has the folders when every check reached the Library", () => {
    expect(
      savedMessage([
        { label: "NAS", reach: reach(true) },
        { label: "Amish_Station", reach: reach(true) },
      ]),
    ).toBe("Folders saved, and every machine has read them.");
  });

  it("promises a machine that did not answer only what a start does", () => {
    expect(
      savedMessage([
        { label: "NAS", reach: reach(true) },
        { label: "Amish_Station", reach: null },
        { label: "Garage", reach: null },
      ]),
    ).toBe(
      "Folders saved. Amish_Station and Garage did not answer, and will read them the next time they start a model.",
    );
  });

  it("promises nothing for a machine that answered and could not read them", () => {
    // The live install: a control host registered at 127.0.0.1 stays
    // unreachable however many models start.
    expect(
      savedMessage([
        { label: "NAS", reach: reach(true) },
        { label: "Amish_Station", reach: { ...reach(false), libraryError: "loopback" } },
      ]),
    ).toBe("Folders saved. Amish_Station could not read them; the reason is below.");
  });

  it("never tells anyone to reboot or relaunch a node", () => {
    for (const checks of [[{ label: "A", reach: reach(true) }], [{ label: "A", reach: null }]]) {
      expect(savedMessage(checks)).not.toMatch(/reboot|next launch|restart the node/i);
    }
  });
});

describe("unreadFolders", () => {
  it("names each machine that could not read the folders, in the agent's words", () => {
    const why = "The install's Library could not be found: ... advertises http://127.0.0.1:8079/";
    expect(
      unreadFolders([
        { label: "NAS", reach: reach(true) },
        { label: "Amish_Station", reach: { ...reach(false), libraryError: why } },
        { label: "Garage", reach: null },
      ]),
    ).toEqual([{ label: "Amish_Station", reason: why }]);
  });

  it("says nothing for an agent from before libraryError", () => {
    expect(unreadFolders([{ label: "A", reach: reach(false) }])).toEqual([]);
  });
});

describe("restartLabel", () => {
  it("counts the models", () => {
    expect(restartLabel(1)).toBe("Restart this model");
    expect(restartLabel(3)).toBe("Restart these 3 models");
  });
});
