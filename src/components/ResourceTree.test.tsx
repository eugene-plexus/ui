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

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => localStorage.clear());

describe("tree keyboard navigation", () => {
  it("exposes a tree with levels, branch states and the current page", () => {
    render(<ResourceTree tree={TREE} localNode={null} selected="agent:b" ready />);
    const tree = screen.getByRole("tree", { name: "Install" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "2"]);
    expect(items[0]).toHaveAttribute("aria-expanded", "true");
    expect(items[2]).not.toHaveAttribute("aria-expanded");
    expect(items[3]).toHaveAttribute("aria-selected", "true");
    expect(within(items[0]!).getAllByRole("group")).toHaveLength(2);
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([items[3]]);
  });

  it("Down, Right and Left move focus through visible items and branches", async () => {
    const user = userEvent.setup();
    render(<ResourceTree tree={TREE} localNode={null} selected={null} ready />);
    await user.tab();
    const root = screen.getByRole("treeitem", { name: "Eugene Plexus" });
    const branch = screen.getByRole("treeitem", { name: "with-children" });
    expect(root).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(branch).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(branch).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "childless-sibling" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowRight}");
    expect(branch).toHaveFocus();
    expect(branch).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: "grandchild" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(root).toHaveFocus();
  });

  it("Tab enters and leaves once, and Home, End and characters find visible items", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Before</button>
        <ResourceTree tree={TREE} localNode={null} selected={null} ready />
        <button>After</button>
      </>,
    );
    await user.tab();
    await user.tab();
    await user.keyboard("{End}");
    expect(screen.getByRole("treeitem", { name: "childless-sibling" })).toHaveFocus();
    await user.keyboard("{Home}g");
    expect(screen.getByRole("treeitem", { name: "grandchild" })).toHaveFocus();
    await user.keyboard("w{ArrowLeft}{Home}g");
    expect(screen.getByRole("treeitem", { name: "Eugene Plexus" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("treeitem", { name: "Eugene Plexus" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("Enter and a mouse click follow the existing link and close the drawer", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const tree: TreeNode = {
      ...TREE,
      pages: [{ id: "home", label: "Home", route: "/", icon: "Server" }],
    };
    render(
      <ResourceTree
        tree={tree}
        localNode={null}
        selected="install"
        ready
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole("link", { name: "Eugene Plexus" });
    // Keep jsdom on this page while observing actual link activation.
    link.addEventListener("click", (event) => event.preventDefault());
    expect(link).toHaveAttribute("href", "/?sel=install");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("remembers collapsed branches in this browser", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ResourceTree tree={TREE} localNode={null} selected={null} ready />);
    await user.tab();
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    unmount();
    render(<ResourceTree tree={TREE} localNode={null} selected={null} ready />);
    expect(screen.getByRole("treeitem", { name: "with-children" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("treeitem", { name: "grandchild" })).not.toBeInTheDocument();
  });

  it("keeps a tab stop when topology removes a focused item without taking focus from the page", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ResourceTree tree={TREE} localNode={null} selected={null} ready />,
    );
    await user.tab();
    await user.keyboard("{End}");
    rerender(
      <ResourceTree
        tree={{ ...TREE, children: [TREE.children[0]!] }}
        localNode={null}
        selected={null}
        ready
      />,
    );
    expect(screen.getByRole("treeitem", { name: "Eugene Plexus" })).toHaveFocus();
    const outside = document.createElement("button");
    document.body.append(outside);
    await user.click(outside);
    rerender(<ResourceTree tree={TREE} localNode={null} selected={null} ready />);
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

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
