/**
 * The proposed models folder is built from the LIBRARY host's home, joined
 * by the separator that home's shape implies. Two real shapes and the
 * absence, because a wrong separator here is a folder the person cannot
 * find in their file manager and a missing `Home` entry must read as "no
 * proposal", never as a folder at the root.
 */

import { describe, expect, it } from "vitest";

import type { DirectoryListing } from "./types";
import {
  homeFrom,
  joinPath,
  parentOf,
  presetModelsFolder,
  proposedModelsFolder,
  separatorFor,
} from "./proposedModelsFolder";

function listing(entries: { name: string; path: string }[]): DirectoryListing {
  return {
    host: "sam-pc",
    entries: entries.map((e) => ({ ...e, kind: "directory" as const })),
  } as DirectoryListing;
}

describe("proposedModelsFolder", () => {
  it("builds under a Windows home with a backslash", () => {
    const roots = listing([
      { name: "C:\\", path: "C:\\" },
      { name: "D:\\", path: "D:\\" },
      { name: "Home", path: "C:\\Users\\sam" },
    ]);
    expect(homeFrom(roots)).toBe("C:\\Users\\sam");
    expect(proposedModelsFolder(roots)).toBe("C:\\Users\\sam\\Eugene Models");
  });

  it("builds under a POSIX home with a slash", () => {
    const roots = listing([
      { name: "/", path: "/" },
      { name: "Home", path: "/home/sam" },
    ]);
    expect(proposedModelsFolder(roots)).toBe("/home/sam/Eugene Models");
  });

  it("is null when the listing has no Home entry", () => {
    // An older library, or a host whose home could not be resolved. The
    // wizard disables "Make a folder for me" on null; a root-level folder
    // here would be a confident answer to a question nobody asked.
    expect(proposedModelsFolder(listing([{ name: "/", path: "/" }]))).toBeNull();
    expect(proposedModelsFolder(null)).toBeNull();
    expect(proposedModelsFolder(listing([{ name: "Home", path: "  " }]))).toBeNull();
  });
});

describe("joinPath", () => {
  it("absorbs a trailing separator and keeps a root a root", () => {
    expect(joinPath("C:\\Users\\sam\\", "Eugene Models")).toBe("C:\\Users\\sam\\Eugene Models");
    expect(joinPath("C:\\", "Eugene Models")).toBe("C:\\Eugene Models");
    expect(joinPath("/", "Eugene Models")).toBe("/Eugene Models");
    expect(joinPath("/home/sam/", "Eugene Models")).toBe("/home/sam/Eugene Models");
  });

  it("treats a UNC path as Windows", () => {
    expect(joinPath("\\\\TOWER\\models", "Eugene Models")).toBe("\\\\TOWER\\models\\Eugene Models");
  });

  it("reads the separator off the path's shape, not the browser's platform", () => {
    expect(separatorFor("D:\\models")).toBe("\\");
    expect(separatorFor("\\\\nas\\share")).toBe("\\");
    expect(separatorFor("/srv/models")).toBe("/");
    // No recognisable prefix: follow what the path already uses.
    expect(separatorFor("models\\here")).toBe("\\");
    expect(separatorFor("models/here")).toBe("/");
    expect(separatorFor("models")).toBe("/");
  });
});

describe("a folder the installer already chose", () => {
  it("is the first Library folder, in either shape the library sends", () => {
    expect(presetModelsFolder({ folders: [{ path: "/home/sam/Eugene Models", mounts: [] }] })).toBe(
      "/home/sam/Eugene Models",
    );
    expect(presetModelsFolder({ folders: ["/models"] })).toBe("/models");
  });

  it("is nothing on an install that chose none, or a library that did not answer", () => {
    expect(presetModelsFolder({ folders: [] })).toBeNull();
    expect(presetModelsFolder(null)).toBeNull();
    expect(presetModelsFolder({ folders: [{ path: "  " }] })).toBeNull();
    expect(presetModelsFolder({ folders: "nope" })).toBeNull();
  });

  it("starts a picker in the folder's parent", () => {
    expect(parentOf("/home/sam/Eugene Models")).toBe("/home/sam");
    expect(parentOf("/models")).toBe("/models");
  });
});
