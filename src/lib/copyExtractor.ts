/** Build/test-only JSX reader. TypeScript never enters the browser bundle. */
import ts from "typescript";

export function jsxCopy(source: string): string[] {
  const tree = ts.createSourceFile(
    "copy.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const copy: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text) copy.push(text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return copy;
}
