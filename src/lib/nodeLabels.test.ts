import { afterEach, describe, expect, it } from "vitest";

import { labelOf, labelsFrom, nodeLabel, recordNodeLabels, resetNodeLabels } from "./nodeLabels";

afterEach(() => resetNodeLabels());

describe("node labels", () => {
  it("shows the label and falls back to the name", () => {
    expect(nodeLabel({ name: "468e3ed662bf", label: "The NAS" })).toBe("The NAS");
    expect(nodeLabel({ name: "468e3ed662bf", label: "  " })).toBe("468e3ed662bf");
    expect(nodeLabel({ name: "468e3ed662bf", label: null })).toBe("468e3ed662bf");
  });

  it("never shows two machines under one name", () => {
    const words = labelsFrom([
      { name: "studio", label: null },
      { name: "DESKTOP-4KJ2P9", label: "Studio" },
      { name: "468e3ed662bf", label: "The NAS" },
    ]);
    expect(words.get("DESKTOP-4KJ2P9")).toBe("Studio (DESKTOP-4KJ2P9)");
    expect(words.get("468e3ed662bf")).toBe("The NAS");
    expect(words.has("studio")).toBe(false);
  });

  it("labelOf reads the latest roster and leaves unknown names alone", () => {
    expect(labelOf("468e3ed662bf")).toBe("468e3ed662bf");
    recordNodeLabels([{ name: "468e3ed662bf", label: "The NAS" }]);
    expect(labelOf("468e3ed662bf")).toBe("The NAS");
    expect(labelOf("Amish_Station")).toBe("Amish_Station");
    expect(labelOf(null)).toBeNull();
    recordNodeLabels([{ name: "468e3ed662bf" }]);
    expect(labelOf("468e3ed662bf")).toBe("468e3ed662bf");
  });
});
