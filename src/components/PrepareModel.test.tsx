/**
 * LS5: *Prepare for Strata*, apart from the pages that place it. What it
 * says before anything starts, and what it hands the run store.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TargetNode } from "@/lib/nodeBudget";
import type { SupportedModel } from "@/lib/types";

import { PrepareControl, entryForFile } from "./PrepareModel";

const NODE: TargetNode = {
  name: "amish",
  label: "amish",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};
const ENTRY: SupportedModel = {
  id: "IQ2_XS",
  title: "Qwen3.8-Flash-Next IQ2_XS",
  format: "gguf",
  source: {
    repoId: "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF",
    file: "IQ2_XS/Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf",
    revision: "ed59f92",
  },
  preparation: { recipe: "strata-prepare", note: "a pack", diskBytes: 44_500_000_000 },
  recommended: true,
  experimental: false,
};

describe("PrepareControl", () => {
  it("leaves the context to the engine when it offers none to choose", () => {
    const start = vi.fn(() => "prep_1");
    render(
      <PrepareControl engine="strata" entry={ENTRY} node={NODE} where="amish" onStart={start} />,
    );
    expect(screen.queryByTestId("prepare-context")).toBeNull();
    expect(screen.getByTestId("prepare-disk")).toHaveTextContent("44.50 GB");
    fireEvent.click(screen.getByTestId("prepare-start"));
    expect(start).toHaveBeenCalledWith({ engine: "strata", contextSize: null });
  });

  it("says first what a download and prepare fetches", () => {
    render(
      <PrepareControl
        engine="strata"
        entry={ENTRY}
        node={NODE}
        where="amish"
        download={68_026_093_024}
        onStart={vi.fn(() => "dl_1")}
      />,
    );
    expect(screen.getByTestId("prepare-model")).toHaveTextContent("First it downloads 68.03 GB.");
    expect(screen.getByTestId("prepare-start")).toHaveTextContent(
      "Download and prepare for Strata",
    );
  });

  it("cannot start without a node, or where the engine cannot run, and says why", () => {
    const start = vi.fn(() => "x");
    const { rerender } = render(
      <PrepareControl engine="strata" entry={ENTRY} node={null} where="amish" onStart={start} />,
    );
    expect(screen.getByTestId("prepare-start")).toBeDisabled();
    rerender(
      <PrepareControl
        engine="strata"
        entry={ENTRY}
        node={NODE}
        where="amish"
        disabledReason="Strata cannot run on amish."
        onStart={start}
      />,
    );
    expect(screen.getByTestId("prepare-start")).toBeDisabled();
    expect(screen.getByTestId("prepare-model")).toHaveTextContent("Strata cannot run on amish.");
    fireEvent.click(screen.getByTestId("prepare-start"));
    expect(start).not.toHaveBeenCalled();
  });

  it("says the node's engine is too old to prepare it, and how to fix that (B30)", () => {
    const start = vi.fn(() => "x");
    const old: SupportedModel = {
      ...ENTRY,
      preparation: { ...ENTRY.preparation!, minEngineVersion: "v0.1.38", engineTooOld: "v0.1.37" },
    };
    render(
      <PrepareControl engine="strata" entry={old} node={NODE} where="amish" onStart={start} />,
    );
    expect(screen.getByTestId("prepare-engine-too-old")).toHaveTextContent(
      "This needs Strata v0.1.38 or newer, and amish has v0.1.37: update Strata on amish from Backends first.",
    );
    expect(screen.getByTestId("prepare-start")).toBeDisabled();
    fireEvent.click(screen.getByTestId("prepare-start"));
    expect(start).not.toHaveBeenCalled();
  });
});

describe("PrepareControl, when pressing it cannot start anything", () => {
  it("says why it cannot be pressed with no machine to run on", () => {
    render(
      <PrepareControl
        engine="strata"
        entry={ENTRY}
        node={null}
        where="amish"
        onStart={vi.fn(() => "x")}
      />,
    );
    expect(screen.getByTestId("prepare-start")).toBeDisabled();
    expect(screen.getByTestId("prepare-no-node")).toHaveTextContent(
      "Working out which machine this runs on",
    );
  });

  it("shows why nothing started when starting fails, instead of nothing", () => {
    const start = vi.fn((): string => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    render(
      <PrepareControl engine="strata" entry={ENTRY} node={NODE} where="amish" onStart={start} />,
    );
    fireEvent.click(screen.getByTestId("prepare-start"));
    expect(screen.getByTestId("prepare-start-error")).toHaveTextContent(
      "Nothing was started: crypto.randomUUID is not a function",
    );
  });
});

describe("entryForFile", () => {
  it("finds the entry by the first shard's name, case ignored, in either separator", () => {
    expect(
      entryForFile([ENTRY], "D:\\models\\x\\qwen3.8-flash-next-gsq-rco-iq2_xs-00001-of-00002.gguf"),
    ).toBe(ENTRY);
    expect(
      entryForFile([ENTRY], "/models/x/Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf"),
    ).toBeNull();
    expect(entryForFile(undefined, "/models/x.gguf")).toBeNull();
  });
});
