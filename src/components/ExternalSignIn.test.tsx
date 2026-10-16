import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExternalSignIn } from "./ExternalSignIn";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/v1/config"))
        return Response.json({ oidcIssuer: "https://eugene.example/oidc" });
      if (String(url).endsWith("/v1/auth/providers")) return Response.json({ providers: [] });
      throw new Error("Unexpected request " + url);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("shows the managed address and callback without requiring a second address entry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/v1/config")) return Response.json({ oidcIssuer: null });
      return Response.json({
        providers: [],
        signInAddress: "https://eugene.example/oidc",
        managedSignInAddress: "https://eugene.example/oidc",
      });
    }),
  );
  const user = userEvent.setup();
  render(<ExternalSignIn />);
  await user.click(screen.getByText("External sign-in", { exact: true }));
  expect(await screen.findByText("https://eugene.example/oidc", { exact: true })).toBeVisible();
  expect(
    screen.getByText("https://eugene.example/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  expect(screen.getByLabelText("Eugene sign-in address", { exact: true })).not.toBeVisible();
  await user.click(screen.getByRole("button", { name: "Add sign-in provider" }));
  expect(screen.getByRole("button", { name: "Save provider" })).toBeVisible();
});

it("keeps a saved sign-in address when access setup has a different hostname", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    return String(url).endsWith("/v1/config")
      ? Response.json({ oidcIssuer: "https://original.example/oidc" })
      : Response.json({
          providers: [],
          signInAddress: "https://original.example/oidc",
          managedSignInAddress: "https://eugene.example/oidc",
        });
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ExternalSignIn />);
  await user.click(screen.getByText("External sign-in", { exact: true }));
  expect(
    await screen.findByText("https://original.example/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  expect(
    fetcher.mock.calls.every(
      (args) =>
        args.length === 1 ||
        !(args[1] as RequestInit)?.method ||
        (args[1] as RequestInit)?.method === "GET",
    ),
  ).toBe(true);
});

it("offers accessible provider choices and retains an unfinished registration when folded", async () => {
  const user = userEvent.setup();
  render(<ExternalSignIn />);
  await user.click(screen.getByText("External sign-in", { exact: true }));
  await user.click(await screen.findByRole("button", { name: "Add sign-in provider" }));
  await user.selectOptions(screen.getByLabelText("Provider", { exact: true }), "oidc");
  await user.type(screen.getByLabelText("Button label", { exact: true }), "My provider");
  await user.type(screen.getByLabelText("Client secret", { exact: true }), "unsaved-secret");
  await user.click(screen.getByText("External sign-in", { exact: true }));
  await user.click(screen.getByText("External sign-in", { exact: true }));
  expect(screen.getByLabelText("Button label", { exact: true })).toHaveValue("My provider");
  expect(screen.getByLabelText("Client secret", { exact: true })).toHaveValue("unsaved-secret");
});
