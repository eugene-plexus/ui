/**
 * The unlock's outcome logic, and the confirmation that fixes the
 * double-entry report.
 *
 * From the live install (Troy, 2026-09-21): after a container update
 * the unlock "never takes on the first one". Mechanism: the login on
 * the root derives with Argon2id, which on the NAS outlives the
 * client's 8 s timeout — so the FIRST attempt succeeded server-side
 * after this client had already called it "did not answer", and the
 * second found the root open. The fix is not a bigger timeout alone:
 * an attempt that heard no answer confirms against the status
 * endpoint, which derives nothing, before reporting failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { unlockControlRoot } from "./controlUnlock";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, post: vi.fn(), get: vi.fn() },
  };
});

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

beforeEach(() => {
  vi.useFakeTimers();
  post.mockReset();
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const timeoutError = () =>
  new ApiError(0, "timeout", { detail: { title: "timeout", detail: "exceeded" } });

describe("unlockControlRoot", () => {
  it("a login that answers is unlocked, with no status read spent", async () => {
    post.mockResolvedValueOnce({});
    await expect(unlockControlRoot("pass", "token")).resolves.toBe("unlocked");
    expect(get).not.toHaveBeenCalled();
  });

  it("a 401 is the root answering with a different passphrase — definitive, never re-checked", async () => {
    post.mockRejectedValueOnce(new ApiError(401, "Unauthorized", {}));
    await expect(unlockControlRoot("wrong", "token")).resolves.toBe("mismatch");
    expect(get).not.toHaveBeenCalled();
  });

  it("a timed-out login that actually unsealed the root reads as unlocked, not as a failure", async () => {
    // The double-entry report, reproduced: the login outlives the
    // client's patience, the status read finds the root open.
    post.mockRejectedValueOnce(timeoutError());
    get.mockResolvedValueOnce({ unlocked: true });
    await expect(unlockControlRoot("pass", "token")).resolves.toBe("unlocked");
    expect(get).toHaveBeenCalledWith(
      "control",
      "/v1/auth/status",
      expect.objectContaining({ bearer: "token" }),
    );
  });

  it("still sealed after the confirmation budget is honestly unavailable", async () => {
    post.mockRejectedValueOnce(timeoutError());
    get.mockResolvedValue({ unlocked: false });
    const outcome = unlockControlRoot("pass", "token", { confirmAttempts: 3 });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("unavailable");
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("a login abandoned mid-derivation is caught by a LATER confirmation read", async () => {
    // First status read lands while Argon2id is still running; the
    // second sees the finished unseal. One immediate read — the first
    // version of this fix — would have reported a failure here and
    // reproduced the double entry it exists to remove.
    post.mockRejectedValueOnce(timeoutError());
    get.mockResolvedValueOnce({ unlocked: false }).mockResolvedValueOnce({ unlocked: true });
    const outcome = unlockControlRoot("pass", "token", { confirmAttempts: 4 });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("unlocked");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("a root that answers nothing at all is unavailable", async () => {
    post.mockRejectedValueOnce(timeoutError());
    get.mockRejectedValue(timeoutError());
    const outcome = unlockControlRoot("pass", "token", { confirmAttempts: 2 });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe("unavailable");
  });

  it("the caller's timeout reaches the login request", async () => {
    post.mockResolvedValueOnce({});
    await unlockControlRoot("pass", "token", { timeoutMs: 30_000 });
    expect(post).toHaveBeenCalledWith(
      "control",
      "/v1/auth/login",
      { passphrase: "pass" },
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });
});
