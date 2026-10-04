import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AccessSetup } from "./AccessSetup";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, describeError: (e: Error) => e.message }));

beforeEach(() => vi.clearAllMocks());

async function fillCommon() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Base domain/), "example.org");
  await user.type(screen.getByLabelText(/Allowed private networks/), "192.168.16.0/24");
  return user;
}

it("prepares a private proxy without making administration public and invalidates edited previews", async () => {
  vi.mocked(api.post).mockResolvedValue({
    configuration: {},
    publicUrls: {
      consoleUrl: "https://eugene.example.org",
      workbenchUrl: "https://workbench.example.org",
    },
    instructions: ["No running settings changed."],
  });
  render(<AccessSetup />);
  const user = await fillCommon();
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  await user.click(screen.getByLabelText(/Allow Workbench access/));
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await screen.findByRole("region", { name: "Prepared setup" });
  const body = vi.mocked(api.post).mock.calls[0]![2] as { configuration: Record<string, unknown> };
  expect(body.configuration.proxy).toEqual({ addresses: ["172.30.0.2"], transport: "http" });
  expect(body.configuration.console).toEqual({
    origin: "https://eugene.example.org",
    networks: ["192.168.16.0/24"],
  });
  expect(body.configuration.workbench).toEqual({
    origin: "https://workbench.example.org",
    networks: ["0.0.0.0/0", "::/0"],
  });
  await user.type(screen.getByLabelText(/Base domain/), "x");
  expect(screen.queryByRole("button", { name: "Download configuration" })).not.toBeInTheDocument();
});

it("discards a response when the user edits its configuration while validation is pending", async () => {
  let complete: (value: unknown) => void = () => {};
  vi.mocked(api.post).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  render(<AccessSetup />);
  const user = await fillCommon();
  await user.selectOptions(screen.getByLabelText(/Who manages HTTPS/), "local");
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await user.type(screen.getByLabelText(/Base domain/), "x");
  complete({ configuration: {}, publicUrls: {}, instructions: [] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Prepare setup" })).toBeEnabled());
  expect(screen.queryByRole("region", { name: "Prepared setup" })).not.toBeInTheDocument();
});

it("requires certificate terms and locks automatic issuance to public port 443", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("DNS has not been tested"));
  render(<AccessSetup />);
  const user = await fillCommon();
  await user.selectOptions(screen.getByLabelText(/Who manages HTTPS/), "automatic");
  expect(screen.getByLabelText(/Public HTTPS port/)).toBeDisabled();
  await user.type(screen.getByLabelText(/Certificate contact email/), "owner@example.org");
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  expect(api.post).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText(/I accept/));
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("DNS has not been tested"),
  );
  expect(api.post).toHaveBeenCalledWith(
    "agent",
    "/v1/entrypoint/preview",
    expect.objectContaining({
      configuration: expect.objectContaining({
        acme: { email: "owner@example.org", accept_terms: true, staging: false },
      }),
    }),
  );
});
