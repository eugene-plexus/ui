import { describe, expect, it } from "vitest";

import { availableDoors, doorFromParam, modelsForDoor } from "./doors";
import type { Model } from "./types";

function model(id: string, surfaces?: string[]): Model {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: "eugene-plexus",
    ...(surfaces ? { x_eugene_plexus: { surfaces } } : {}),
  } as Model;
}

describe("modelsForDoor", () => {
  it("keeps chat's old rule: a model with no surfaces is a gateway with no opinion, so chat", () => {
    const old = model("old");
    expect(modelsForDoor([old], "chat")).toEqual([old]);
    expect(modelsForDoor([old], "completion")).toEqual([]);
  });

  it("needs the surface named for every other door", () => {
    const chat = model("chat", ["chat"]);
    const coder = model("coder", ["chat", "completion"]);
    const embed = model("embed", ["embeddings"]);
    expect(modelsForDoor([chat, coder, embed], "completion")).toEqual([coder]);
    expect(modelsForDoor([chat, coder, embed], "chat")).toEqual([chat, coder]);
  });
});

describe("availableDoors", () => {
  it("is chat alone when nothing else is served, and chat even with no models at all", () => {
    expect(availableDoors([]).map((d) => d.id)).toEqual(["chat"]);
    expect(availableDoors([model("a", ["chat"])]).map((d) => d.id)).toEqual(["chat"]);
  });

  it("adds a door when some model lists its surface", () => {
    expect(availableDoors([model("c", ["completion"])]).map((d) => d.id)).toEqual([
      "chat",
      "completion",
    ]);
  });
});

describe("doorFromParam", () => {
  const doors = availableDoors([model("c", ["completion"])]);

  it("opens the door named when it is offered", () => {
    expect(doorFromParam("completion", doors)).toBe("completion");
  });

  it("opens chat for an unknown value, no value, or a door nothing serves", () => {
    expect(doorFromParam("nonsense", doors)).toBe("chat");
    expect(doorFromParam(null, doors)).toBe("chat");
    expect(doorFromParam("completion", availableDoors([]))).toBe("chat");
  });
});
