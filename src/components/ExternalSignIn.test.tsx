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
