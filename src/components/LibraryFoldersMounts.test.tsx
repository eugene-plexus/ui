/**
 * The mount boxes take a Windows path one keystroke at a time.
 *
 * Found 2026-09-26 (Troy): on Config -> Library the Windows box refused
 * keystrokes while the path and the Linux/macOS boxes took them. Each box
 * was read back through the saved list by shape, and a Windows path is not
 * Windows-shaped until its second character -- `\` before `\\`, `C` before
 * `C:` -- so every first keystroke read back as empty and was lost, and was
 * kept as a Linux/macOS mount on the way. Typed here through a controlled
 * parent, as the Config editor holds it, because that loop is the defect.
 *
 * The Folders page renders the same boxes; it is driven below with its
 * reads answered.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import { LibraryFolders } from "./LibraryFolders";
import type { ConfigField } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library/folders",
  useSearchParams: () => new URLSearchParams(),
}));

const FOLDERS: ConfigField = {
  key: "modelRoots",
  label: "Library folders",
  valueType: "library_folders",
  category: "library",
  sensitive: false,
  required: false,
  requiresRestart: false,
  pendingRestart: false,
  default: [],
};

const UNC = String.raw`\\192.168.16.252\downloads\models`;

function Harness({ initial, onValue }: { initial: unknown; onValue: (v: unknown) => void }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <ConfigFieldInput
      field={FOLDERS}
      value={value}
      pending={false}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

describe("Config -> Library folders", () => {
  it("types a share path into the Windows box, keystroke by keystroke", async () => {
    const onValue = vi.fn();
    render(<Harness initial={[{ path: "/models", mounts: [] }]} onValue={onValue} />);
    const windows = screen.getByLabelText("Mount on Windows nodes");
    await userEvent.type(windows, UNC);

    expect(windows).toHaveValue(UNC);
    expect(screen.getByLabelText("Mount on Linux and macOS nodes")).toHaveValue("");
    expect(onValue).toHaveBeenLastCalledWith([{ path: "/models", mounts: [UNC] }]);
  });

  it("types a drive-letter path too, and keeps the Linux/macOS mount beside it", async () => {
    const onValue = vi.fn();
    render(<Harness initial={[{ path: "/models", mounts: ["/mnt/models"] }]} onValue={onValue} />);
    await userEvent.type(screen.getByLabelText("Mount on Windows nodes"), String.raw`Z:\models`);

    expect(screen.getByLabelText("Mount on Windows nodes")).toHaveValue(String.raw`Z:\models`);
    expect(screen.getByLabelText("Mount on Linux and macOS nodes")).toHaveValue("/mnt/models");
    expect(onValue).toHaveBeenLastCalledWith([
      { path: "/models", mounts: ["/mnt/models", String.raw`Z:\models`] },
    ]);
  });

  it("says so when a box holds the other system's kind of path", async () => {
    render(<Harness initial={[{ path: "/models", mounts: [] }]} onValue={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Mount on Windows nodes"), "/mnt/models");
    expect(screen.getByTestId("mount-problem-windows")).toHaveTextContent(
      "/mnt/models is a Linux/macOS path",
    );
  });

  it("keeps each row's boxes with their own folder when one is removed", async () => {
    const onValue = vi.fn();
    render(
      <Harness
        initial={[
          { path: "/a", mounts: [] },
          { path: "/b", mounts: [] },
        ]}
        onValue={onValue}
      />,
    );
    // Both rows typed into: with the typed boxes left where they were, the
    // remaining folder would show the removed one's path.
    const [first, second] = screen.getAllByLabelText("Mount on Windows nodes");
    await userEvent.type(first!, String.raw`X:\a`);
    await userEvent.type(second!, String.raw`Y:\b`);
    await userEvent.click(screen.getAllByRole("button", { name: "remove" })[0]!);

    expect(screen.getAllByLabelText("Mount on Windows nodes")).toHaveLength(1);
    expect(screen.getByLabelText("Mount on Windows nodes")).toHaveValue(String.raw`Y:\b`);
    expect(onValue).toHaveBeenLastCalledWith([{ path: "/b", mounts: [String.raw`Y:\b`] }]);
  });
});

describe("Library -> Folders", () => {
  beforeEach(() => {
    sessionStorage.setItem("eugene-session-token", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const route = String(input).replace(/^\/api\/proxy\//, "");
        const key = `${init?.method ?? "GET"} ${route}`;
        const body =
          key === "GET library/v1/folders"
            ? { folders: [{ path: "/models", mounts: [] }] }
            : key.endsWith("/v1/library/folders/check")
              ? { libraryConsulted: true, folders: [] }
              : key === "GET agent/v1/node"
                ? { enrolled: false, name: null, devices: [] }
                : key === "GET agent/v1/components"
                  ? { components: [] }
                  : {};
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("types a share path into the grid's Windows box, keystroke by keystroke", async () => {
    // `undefined` is the install-wide grid; `null` is this machine alone.
    render(<LibraryFolders nodeName={undefined} />);
    const grid = await screen.findByTestId("folders-grid", {}, { timeout: 5000 });
    const windows = await within(grid).findByTestId("mount-windows");
    await userEvent.type(windows, UNC);
    expect(windows).toHaveValue(UNC);
    expect(within(grid).getByTestId("mount-posix")).toHaveValue("");
  });
});
