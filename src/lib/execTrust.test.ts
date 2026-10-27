import { describe, expect, it } from "vitest";

import { approvalQuestion } from "./execTrust";

describe("the question before Eugene's account runs someone's program (row 8c)", () => {
  it("names the program, its folder, and the account that can then act as Eugene", () => {
    expect(
      approvalQuestion({
        kind: "needs_approval",
        path: "/home/ada/bin/llama-server",
        account: "ada",
        sha256: "ab".repeat(32),
      }),
    ).toBe(
      "Run llama-server from /home/ada/bin as Eugene's account? Anyone who can change this file (ada) can then act as Eugene.",
    );
  });

  it("says the root folder plainly", () => {
    expect(
      approvalQuestion({ kind: "needs_approval", path: "/vllm", account: "ada", sha256: "x" }),
    ).toBe(
      "Run vllm from / as Eugene's account? Anyone who can change this file (ada) can then act as Eugene.",
    );
  });
});
