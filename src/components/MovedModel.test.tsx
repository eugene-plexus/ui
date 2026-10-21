/**
 * Row 22: a missing model says where its file went, and moves its profiles
 * only when asked. What each case says, what it asks first, and what it sends.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MovedModel, MovedNotice, movedLead } from "./MovedModel";
import { api } from "@/lib/api";
import type {
  LibraryModel,
  ModelRelocated,
  RelocateCandidate,
  RelocateCandidateList,
} from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  describeError: (e: Error) => e.message,
}));
afterEach(cleanup);

const OLD = "D:\\models\\x.gguf";
const NEW = "E:\\llm\\x.gguf";

function listed(over: Partial<LibraryModel> = {}): LibraryModel {
  return {
    id: "old",
    path: OLD,
    format: "gguf",
    name: "x",
    status: "missing",
    profileCount: 2,
    ...over,
  } as LibraryModel;
}

function candidate(
  id: string,
  path: string,
  match: RelocateCandidate["match"] = "same",
): RelocateCandidate {
  return {
    model: { id, path, format: "gguf", name: "x", status: "present" } as LibraryModel,
    match,
    differences: match === "same" ? [] : ["The missing file was never fingerprinted."],
  };
}

function relocated(): ModelRelocated {
  return {
    model: { id: "new", path: NEW, format: "gguf", name: "x", status: "present" } as LibraryModel,
    moved: 2,
    renamed: [],
    warnings: [],
  };
}

function found(candidates: RelocateCandidate[]) {
  vi.mocked(api.get).mockResolvedValue({ candidates } satisfies RelocateCandidateList);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue(relocated());
});

it("asks the Library where the file may have gone", async () => {
  found([]);
  render(<MovedModel model={listed()} onMoved={() => undefined} />);
  await screen.findByTestId("moved-model");
  expect(api.get).toHaveBeenCalledWith("library", "/v1/models/old/relocate-candidates");
});

it("says where a file with the same contents is, and moves nothing until clicked", async () => {
  found([candidate("new", NEW)]);
  render(<MovedModel model={listed()} onMoved={() => undefined} />);

  expect(await screen.findByTestId("moved-lead")).toHaveTextContent(
    `Missing from ${OLD}. Found at ${NEW}.`,
  );
  expect(screen.getByRole("button", { name: /Move 2 profiles to/ })).toHaveTextContent(
    "Move 2 profiles there",
  );
  // Nothing moves on its own: not on the read, not on a wait.
  await new Promise((r) => setTimeout(r, 30));
  expect(api.post).not.toHaveBeenCalled();
});

it("sends the click's target, and no confirmation for a proven match", async () => {
  found([candidate("new", NEW)]);
  const onMoved = vi.fn();
  render(<MovedModel model={listed()} onMoved={onMoved} />);

  const button = await screen.findByRole("button", { name: /Move 2 profiles to/ });
  await act(async () => {
    fireEvent.click(button);
  });

  await waitFor(() => expect(onMoved).toHaveBeenCalledWith(relocated()));
  expect(api.post).toHaveBeenCalledWith("library", "/v1/models/old/relocate", { to: "new" });
});

it("says 1 profile for one", async () => {
  found([candidate("new", NEW)]);
  render(<MovedModel model={listed({ profileCount: 1 })} onMoved={() => undefined} />);
  expect(await screen.findByRole("button", { name: /Move 1 profile to/ })).toHaveTextContent(
    "Move 1 profile there",
  );
});

it("cannot prove an entry from before fingerprints, says so, and asks first", async () => {
  found([candidate("new", NEW, "likely")]);
  const onMoved = vi.fn();
  render(<MovedModel model={listed()} onMoved={onMoved} />);

  expect(await screen.findByTestId("moved-lead")).toHaveTextContent(
    `Missing. A file with the same size and details is at ${NEW}. Eugene cannot prove it is the same file.`,
  );
  fireEvent.click(screen.getByRole("button", { name: /Move anyway/ }));
  await new Promise((r) => setTimeout(r, 30));
  expect(api.post).not.toHaveBeenCalled();
  const ask = screen.getByRole("group", { name: "Confirm" });
  expect(ask).toHaveTextContent(
    `Move 2 profiles to ${NEW}? Their settings will apply to that file.`,
  );

  await act(async () => {
    fireEvent.click(within(ask).getByRole("button", { name: "Move anyway" }));
  });

  await waitFor(() => expect(onMoved).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith("library", "/v1/models/old/relocate", {
    to: "new",
    confirmLikely: true,
  });
});

it("backing out of Move anyway sends nothing", async () => {
  found([candidate("new", NEW, "likely")]);
  render(<MovedModel model={listed()} onMoved={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: /Move anyway/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await new Promise((r) => setTimeout(r, 30));
  expect(api.post).not.toHaveBeenCalled();
});

it("says no file has the same contents when none is found", async () => {
  found([]);
  render(<MovedModel model={listed()} onMoved={() => undefined} />);
  expect(await screen.findByTestId("moved-lead")).toHaveTextContent(
    "Missing. No file with the same contents is in your Library folders.",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("lists every file with the same contents, and the person picks", async () => {
  found([candidate("one", "E:\\a\\x.gguf"), candidate("two", "F:\\b\\x.gguf")]);
  const onMoved = vi.fn();
  render(<MovedModel model={listed()} onMoved={onMoved} />);

  expect(await screen.findByTestId("moved-lead")).toHaveTextContent(
    `Missing from ${OLD}. The same file is in 2 places. Choose where it went.`,
  );
  expect(screen.getAllByTestId("moved-candidate")).toHaveLength(2);
  expect(screen.getByText("E:\\a\\x.gguf")).toBeInTheDocument();
  expect(screen.getByText("F:\\b\\x.gguf")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Move 2 profiles to F:\\b\\x.gguf" }));
  });

  await waitFor(() => expect(onMoved).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith("library", "/v1/models/old/relocate", { to: "two" });
});

it("shows the Library's refusal, and does not say it moved", async () => {
  found([candidate("new", NEW)]);
  vi.mocked(api.post).mockRejectedValue(
    new Error(`${NEW} is a different file: its contents differ.`),
  );
  const onMoved = vi.fn();
  render(<MovedModel model={listed()} onMoved={onMoved} />);

  const button = await screen.findByRole("button", { name: /Move 2 profiles to/ });
  await act(async () => {
    fireEvent.click(button);
  });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(`${NEW} is a different file: its contents differ.`);
  expect(onMoved).not.toHaveBeenCalled();
});

it("names the cause when the Library cannot say where it went", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("the Library did not answer"));
  render(<MovedModel model={listed()} onMoved={() => undefined} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Eugene could not check where it went: the Library did not answer",
  );
});

it("leads with the state in one sentence", () => {
  expect(movedLead(OLD, [])).toBe(
    "Missing. No file with the same contents is in your Library folders.",
  );
  expect(movedLead(OLD, [candidate("a", "E:\\a"), candidate("b", "E:\\b")])).toMatch(
    /^Missing from .* The same file is in 2 places/,
  );
  expect(
    movedLead(OLD, [candidate("a", "E:\\a", "likely"), candidate("b", "E:\\b", "likely")]),
  ).toMatch(/^Missing\. Files with the same size and details are in these places/);
});

it("tells the person what moved, what was renamed and what still names the old path", () => {
  render(
    <MovedNotice
      done={{
        ...relocated(),
        renamed: [{ name: "fast", renamedTo: "fast (moved)" }],
        warnings: ['The profile "vision" still names the old path in its extra arguments.'],
      }}
    />,
  );
  const notice = screen.getByTestId("moved-notice");
  expect(notice).toHaveTextContent(`Profiles moved to ${NEW}.`);
  expect(notice).toHaveTextContent("fast is now fast (moved)");
  expect(screen.getByTestId("moved-warning")).toHaveTextContent("still names the old path");
});
