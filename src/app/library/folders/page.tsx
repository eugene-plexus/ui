"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/AppShell";
import { LibraryFolders } from "@/components/LibraryFolders";
import { parseSelection } from "@/lib/resourceTree";

/**
 * The Library's folders and how each node reaches them (2026-09-14).
 *
 * One route, two views, chosen by the tree: `?sel=library` is the grid
 * of every folder against every node; `?sel=library:node:<name>` (or the
 * bare `library:node` on an unenrolled box) is one machine's column with
 * its Override box. The page does not decide which; the selection does,
 * exactly as `/config` stopped deciding what it was about when the tree
 * arrived. Design: `specs/docs/design/library-folders-and-reach.md` §5.
 */
export default function LibraryFoldersPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const selection = parseSelection(searchParams.get("sel"));
  // `undefined` is the grid; a name (or null for the local machine) is
  // one node's column.
  const nodeName = selection?.type === "libraryNode" ? selection.node : undefined;
  return (
    <AppShell>
      <LibraryFolders nodeName={nodeName} />
    </AppShell>
  );
}
