import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishAdministrationSignIn } from "./administrationSignIn";
import { api } from "./api";

vi.mock("./api", () => ({ api: { post: vi.fn() } }));
const key = "eugene-administration-signin";
beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api.post).mockReset();
  window.history.replaceState(null, "", "/administration/");
});
afterEach(() => sessionStorage.clear());

function callback(over = {}) {
  const issuer = window.location.origin + "/oidc";
  sessionStorage.setItem(
    key,
    JSON.stringify({
      issuer,
      state: "expected-state",
      verifier: "private-verifier",
      redirectUri: window.location.origin + "/administration/",
      expires: Date.now() + 60_000,
      ...over,
    }),
  );
  window.history.replaceState(
    null,
    "",
    "/administration/?" +
      new URLSearchParams({
        code: "one-use-code",
        state: "expected-state",
        iss: issuer,
      }),
  );
}

it("exchanges a bound callback without borrowing the owner's token and clears it", async () => {
  callback();
  vi.mocked(api.post).mockResolvedValue({ sessionToken: "named-session" });
  expect(await finishAdministrationSignIn()).toBe("named-session");
  expect(api.post).toHaveBeenCalledWith(
    "control",
    "/v1/auth/administration/code",
    {
      code: "one-use-code",
      verifier: "private-verifier",
      redirectUri: window.location.origin + "/administration/",
    },
    { skipAuth: true },
  );
  expect(window.location.search).toBe("");
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(await finishAdministrationSignIn()).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it.each([{ state: "different" }, { issuer: "https://another.example/oidc" }, { expires: 1 }])(
  "rejects mismatched or expired browser state before exchanging a code: %j",
  async (over) => {
    callback(over);
    await expect(finishAdministrationSignIn()).rejects.toThrow("does not match");
    expect(api.post).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem(key)).toBeNull();
  },
);

it("refuses a callback opened in a different browser", async () => {
  callback();
  sessionStorage.clear();
  await expect(finishAdministrationSignIn()).rejects.toThrow("another browser");
  expect(api.post).not.toHaveBeenCalled();
});
