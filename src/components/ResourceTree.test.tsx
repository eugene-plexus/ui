/**
 * The tree's gutter, structurally.
 *
 * Legibility handoff §4: a row with children sat ~5px right of its
 * childless sibling once the font-size preference raised the root,
 * because the toggle was sized in rem (`px-1` + a rem glyph) while the
 * spacer standing in for it was a fixed `w-[15px]`. Indentation that
 * varies by anything other than depth is the tree lying about the
 * topology — `Amish_Station` read as a child of the node beside it.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` cannot measure
 * the drift here; what CAN be pinned is the property that produces
 * alignment at every root size: both arms render the SAME box, sized
 * in rem-based utilities, with no px width anywhere in either.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TreeNode } from "@/lib/resourceTree";

import { ResourceTree } from "./ResourceTree";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const leaf = (label: string, sel: string): TreeNode => ({
  sel,
  kind: "leaf",
  label,
  layer: "agent",
  icon: "Server",
  children: [],
  pages: [],
});

/** Two siblings at one depth: one with children, one without — the
 * exact pair the screenshot showed misaligned. */
const TREE: TreeNode = {
  sel: "install",
  kind: "install",
  label: "Eugene Plexus",
  layer: null,
  icon: "Server",
  children: [
    {
      ...leaf("with-children", "agent:a"),
      kind: "nodeGroup",
      children: [leaf("grandchild", "agent:a:child")],
    },
    leaf("childless-sibling", "agent:b"),
  ],
  pages: [],
};

function sizingTokens(className: string): string[] {
  return className.split(/\s+/).filter((t) => /^(h-|w-|min-w|max-w|px-|py-|p-)/.test(t));
}

describe("the twist gutter", () => {
  it("the toggle and the spacer are the same box, in units that scale with the root", () => {
    render(<ResourceTree tree={TREE} localNode={null} selected={null} ready={true} />);
    const toggle = screen.getByTestId("tree-toggle-agent:a");
    const spacer = screen.getAllByTestId("tree-twist-spacer")[0]!;

    // Same sizing tokens on both arms: this is what keeps every row's
    // label at the same x whatever the root font-size is.
    expect(sizingTokens(spacer.className)).toEqual(expect.arrayContaining(["h-5", "w-5"]));
    expect(sizingTokens(toggle.className)).toEqual(expect.arrayContaining(["h-5", "w-5"]));
    const widthOf = (el: Element) =>
      el.className.split(/\s+/).filter((t) => t.startsWith("w-") || t.startsWith("px-"));
    expect(widthOf(toggle)).toEqual(widthOf(spacer));

    // And no px anywhere in either box — a px arm is the drift coming
    // back the next time someone edits one side.
    expect(toggle.className).not.toMatch(/\[\d+px\]/);
    expect(spacer.className).not.toMatch(/\[\d+px\]/);
  });
});

describe("a row's whole name", () => {
  const LONG = "qwen3-coder-30b-a3b-instruct-UD-Q4_K_XL-long-context-driver";
  const tree: TreeNode = {
    ...TREE,
    hint: "control root unreachable",
    children: [...TREE.children, leaf(LONG, "driver:gpu:x")],
  };

  it("is on hover, since the column cuts it where two versions differ", () => {
    render(<ResourceTree tree={tree} localNode={null} selected={null} ready={true} />);
    expect(screen.getByTitle(LONG)).toBeInTheDocument();
    expect(screen.getByTitle("Eugene Plexus · control root unreachable")).toBeInTheDocument();
  });
});
