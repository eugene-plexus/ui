import { describe, expect, it } from "vitest";
import { servingSentence } from "./servingSentence";

describe("servingSentence", () => {
  it("states people, speed, first token and workload", () => {
    expect(
      servingSentence(
        { found: true, people: 12, tokensPerSecondEach: 20, ttftP50Ms: 1400 },
        "agents",
      ),
    ).toBe("12 people at 20 tok/s each, first token in 1.4 s (agent sessions).");
  });
  it("does not claim an unmeasured limit", () => {
    expect(
      servingSentence(
        { found: false, people: 32, tokensPerSecondEach: 18, ttftP50Ms: 200 },
        "streams",
      ),
    ).toBe("At least 32 people at 18 tok/s each. The limit is above 32.");
  });
  it("names the second person slowing both", () => {
    expect(
      servingSentence({ found: true, people: 1, tokensPerSecondEach: 45, ttftP50Ms: 200 }, "chat"),
    ).toBe("One person at 45 tok/s. A second person slows both.");
  });
  it("keeps an unfinished result unknown", () =>
    expect(servingSentence(null, "agents")).toBe("No usable level measured yet."));
});
