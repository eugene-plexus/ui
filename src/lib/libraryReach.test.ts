import { describe, expect, it } from "vitest";

import {
  cellFor,
  foldersProblem,
  isWindowsShaped,
  libraryFoldersHref,
  librarySelectionFor,
  mountFor,
  parseFolders,
  withMount,
} from "./libraryReach";
import type { LibraryFolderReach } from "./types";

describe("the shape of a path says which nodes it is for", () => {
  it("reads a drive letter or a UNC prefix as Windows and a leading slash as POSIX", () => {
    expect(isWindowsShaped("Z:\\models")).toBe(true);
    expect(isWindowsShaped("D:")).toBe(true);
    expect(isWindowsShaped("\\\\NAS\\models")).toBe(true);
    expect(isWindowsShaped("//nas/models")).toBe(true);
    expect(isWindowsShaped("/mnt/models")).toBe(false);
    expect(isWindowsShaped("models")).toBe(false);
  });

  it("gives a node the first mount of its own shape", () => {
    const folder = { path: "/models", mounts: ["/mnt/models", "\\\\NAS\\models"] };
    expect(mountFor(folder, "posix")).toBe("/mnt/models");
    expect(mountFor(folder, "windows")).toBe("\\\\NAS\\models");
    expect(mountFor({ path: "/models", mounts: [] }, "windows")).toBeNull();
  });
});

describe("folders, whatever shape they arrive in", () => {
  it("reads a bare string as a folder with no mounts and keeps objects' mounts", () => {
    expect(parseFolders(["/a", { path: "/b", mounts: ["/m", 3, ""] }, 7, { mounts: [] }])).toEqual([
      { path: "/a", mounts: [] },
      { path: "/b", mounts: ["/m"] },
    ]);
    expect(parseFolders("/a")).toEqual([]);
  });

  it("replaces only the mount of the edited shape", () => {
    const folder = { path: "/models", mounts: ["/mnt/models", "Z:\\models"] };
    expect(withMount(folder, "windows", "\\\\NAS\\models").mounts).toEqual([
      "/mnt/models",
      "\\\\NAS\\models",
    ]);
    expect(withMount(folder, "posix", "").mounts).toEqual(["Z:\\models"]);
    expect(withMount({ path: "/x", mounts: [] }, "posix", "/mnt/x").mounts).toEqual(["/mnt/x"]);
  });

  it("names what the library would reject, before the round trip", () => {
    expect(foldersProblem([{ path: "/models", mounts: ["/mnt/a", "Z:\\a"] }])).toBeNull();
    expect(foldersProblem([{ path: "", mounts: [] }])).toContain("no path");
    expect(
      foldersProblem([
        { path: "/a", mounts: [] },
        { path: "/A", mounts: [] },
      ]),
    ).toContain("twice");
    expect(foldersProblem([{ path: "/a", mounts: ["models"] }])).toContain("not an absolute path");
    expect(foldersProblem([{ path: "/a", mounts: ["/m1", "/m2"] }])).toContain("two posix mounts");
  });
});

describe("one node's cell for one folder", () => {
  const reach: LibraryFolderReach = {
    libraryConsulted: true,
    folderListAgeSeconds: 0,
    folders: [
      {
        path: "/models",
        localPath: "\\\\NAS\\models",
        source: "inherited",
        mount: "\\\\NAS\\models",
        exists: true,
        isDirectory: true,
        modelsUnder: 4,
        modelsReachable: 4,
      },
      {
        path: "/archive",
        localPath: "/archive",
        source: "same_path",
        exists: false,
        problem: "/archive does not exist on this host",
      },
      {
        path: "/scratch",
        localPath: "D:\\scratch",
        source: "override",
        override: { from: "/scratch", to: "D:\\scratch" },
        exists: true,
        isDirectory: true,
        modelsUnder: 2,
        modelsReachable: 1,
        problem: "1 of 2 library models under /scratch are not at their resolved path here",
      },
    ],
  };

  it("is ok, error or warn from the node's own answer", () => {
    expect(cellFor("/models", reach)).toMatchObject({
      tone: "ok",
      source: "inherited",
      localPath: "\\\\NAS\\models",
      note: "inherited · 4 of 4 models reachable",
    });
    expect(cellFor("/archive", reach)).toMatchObject({ tone: "error", source: "same_path" });
    expect(cellFor("/scratch", reach)).toMatchObject({ tone: "warn", source: "override" });
  });

  it("is unknown, never an error, when the node did not answer or lacks the folder", () => {
    expect(cellFor("/models", null)).toMatchObject({
      tone: "unknown",
      note: "node did not answer",
    });
    expect(cellFor("/new", reach)).toMatchObject({
      tone: "unknown",
      note: "not in this node's folder list",
    });
    const stale: LibraryFolderReach = {
      libraryConsulted: false,
      folderListAgeSeconds: 600,
      folders: [],
    };
    expect(cellFor("/new", stale).note).toBe("this node's copy is 10 min old and lacks it");
    const never: LibraryFolderReach = { libraryConsulted: false, folders: [] };
    expect(cellFor("/new", never).note).toContain("never read");
  });
});

describe("the selection for a node under Library", () => {
  it("names the node, or the bare local one on an unenrolled box", () => {
    expect(librarySelectionFor("nas")).toBe("library:node:nas");
    expect(librarySelectionFor(null)).toBe("library:node");
    expect(libraryFoldersHref("Amish_Station")).toBe(
      "/library/folders?sel=library%3Anode%3AAmish_Station",
    );
  });
});
