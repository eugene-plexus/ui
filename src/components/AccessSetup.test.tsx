import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AccessSetup, fieldsFrom, proxiesInsideNetworks } from "./AccessSetup";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
  describeError: (e: Error) => e.message,
}));

const DIRECT = { available: true, path: "/data/entrypoint.json", active: false };
const PREVIEW = {
  configuration: { console: { origin: "https://eugene.example.org" } },
  publicUrls: {
    consoleUrl: "https://eugene.example.org",
    workbenchUrl: "https://workbench.example.org",
  },
  instructions: ["No running settings changed."],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(DIRECT);
});

async function fillCommon() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Base domain/), "example.org");
  await user.type(screen.getByLabelText(/Allowed private networks/), "192.168.16.0/24");
  return user;
}

it("prepares a private proxy without making administration public and invalidates edited previews", async () => {
  vi.mocked(api.post).mockResolvedValue(PREVIEW);
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
  // Two names by default: the inference and node names are extras.
  expect(body.configuration).not.toHaveProperty("inference");
  expect(body.configuration).not.toHaveProperty("nodes");
  await user.type(screen.getByLabelText(/Base domain/), "x");
  expect(screen.queryByRole("button", { name: "Download configuration" })).not.toBeInTheDocument();
});

it("adds the inference and node names only when asked", async () => {
  vi.mocked(api.post).mockResolvedValue(PREVIEW);
  render(<AccessSetup />);
  const user = await fillCommon();
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  await user.click(screen.getByLabelText(/Also an inference name/));
  await user.click(screen.getByLabelText(/Also a name for other machines/));
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await screen.findByRole("region", { name: "Prepared setup" });
  const body = vi.mocked(api.post).mock.calls[0]![2] as { configuration: Record<string, unknown> };
  expect(body.configuration.inference).toEqual({
    origin: "https://inference.example.org",
    networks: ["192.168.16.0/24"],
  });
  expect(body.configuration.nodes).toEqual({
    origin: "https://nodes.example.org",
    networks: ["192.168.16.0/24"],
  });
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

it("applies after asking once, and says where to go next", async () => {
  vi.mocked(api.post).mockImplementation(async (_target, path) =>
    path === "/v1/entrypoint/apply"
      ? {
          ...DIRECT,
          active: true,
          restarting: true,
          publicUrls: PREVIEW.publicUrls,
          confirmBy: "2026-10-05T12:15:00Z",
        }
      : PREVIEW,
  );
  render(<AccessSetup />);
  await screen.findByRole("region", { name: "In effect" });
  const user = await fillCommon();
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await user.click(await screen.findByRole("button", { name: "Apply…" }));
  expect(screen.getByRole("group", { name: "Apply this setup" })).toHaveTextContent(
    "within 15 minutes",
  );
  expect(api.post).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Apply and restart" }));
  expect(api.post).toHaveBeenLastCalledWith("agent", "/v1/entrypoint/apply", {
    configuration: PREVIEW.configuration,
  });
  const restarting = await screen.findByRole("region", { name: "Restarting" });
  expect(restarting).toHaveTextContent("https://eugene.example.org");
  expect(screen.getByRole("link", { name: "https://eugene.example.org" })).toHaveAttribute(
    "href",
    "https://eugene.example.org",
  );
});

it("offers no Apply where one HTTPS port cannot run, and says why", async () => {
  vi.mocked(api.get).mockResolvedValue({
    available: false,
    unavailableReason: "One HTTPS port is part of the Linux container image.",
    path: "C:\\ProgramData\\EugenePlexus\\entrypoint.json",
    active: false,
  });
  vi.mocked(api.post).mockResolvedValue(PREVIEW);
  render(<AccessSetup />);
  expect(await screen.findByRole("region", { name: "In effect" })).toHaveTextContent(
    "part of the Linux container image",
  );
  const user = await fillCommon();
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await screen.findByRole("region", { name: "Prepared setup" });
  expect(screen.queryByRole("button", { name: "Apply…" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download configuration" })).toBeInTheDocument();
});

it("shows a setup that went back, and why", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...DIRECT,
    reverted: "nobody signed in to the console through https://eugene.example.org in time.",
  });
  render(<AccessSetup />);
  const card = await screen.findByRole("region", { name: "In effect" });
  expect(card).toHaveTextContent("direct ports");
  expect(card).toHaveTextContent("The last setup went back: nobody signed in");
});

it("prefills from the setup in effect, waits for approval, and turns it off", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...DIRECT,
    active: true,
    confirmBy: "2026-10-05T12:15:00Z",
    publicUrls: PREVIEW.publicUrls,
    configuration: {
      listen_port: 8088,
      proxy: { addresses: ["172.18.0.4"], transport: "http" },
      console: { origin: "https://eugene.example.org", networks: ["192.168.16.0/24"] },
      workbench: { origin: "https://workbench.example.org", networks: ["0.0.0.0/0", "::/0"] },
    },
  });
  vi.mocked(api.delete).mockResolvedValue({ ...DIRECT, restarting: true });
  render(<AccessSetup />);
  const card = await screen.findByRole("region", { name: "In effect" });
  expect(card).toHaveTextContent("One HTTPS port is on");
  expect(card).toHaveTextContent("Waiting for you to sign in through it");
  await waitFor(() => expect(screen.getByLabelText(/Base domain/)).toHaveValue("example.org"));
  expect(screen.getByLabelText(/Trusted proxy IP addresses/)).toHaveValue("172.18.0.4");
  expect(screen.getByLabelText(/Allow Workbench access/)).toBeChecked();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Turn off one HTTPS port…" }));
  expect(api.delete).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Go back to direct ports" }));
  expect(api.delete).toHaveBeenCalledWith("agent", "/v1/entrypoint");
  expect(await screen.findByRole("region", { name: "Restarting" })).toHaveTextContent(
    "going back to its direct ports",
  );
});

it("reads back only configurations it could have made", () => {
  expect(fieldsFrom(undefined)).toBeNull();
  expect(fieldsFrom({ console: { origin: "https://console.example.org" } })).toBeNull();
  const local = fieldsFrom({
    internal_ca: true,
    console: { origin: "https://eugene.home.arpa:8443", networks: ["10.0.0.0/8"] },
    workbench: { origin: "https://workbench.home.arpa:8443", networks: ["10.0.0.0/8"] },
    nodes: { origin: "https://nodes.home.arpa:8443", networks: ["10.0.0.0/8"] },
  });
  expect(local).toMatchObject({
    mode: "local",
    domain: "home.arpa",
    port: "8443",
    privateNetworks: "10.0.0.0/8",
    publicWorkbench: false,
    nodes: true,
    inference: false,
  });
});

it("opens the console to any network only after its risks are acknowledged", async () => {
  vi.mocked(api.post).mockResolvedValue(PREVIEW);
  render(<AccessSetup />);
  const user = await fillCommon();
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  expect(screen.queryByRole("group", { name: /Risks of a console/ })).not.toBeInTheDocument();
  // Only a console served through this setup can be opened to any network.
  expect(
    screen.queryByRole("checkbox", { name: /Allow the console from any network/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /Through this setup too/ }));
  await user.click(screen.getByRole("checkbox", { name: /Allow the console from any network/ }));
  const risks = screen.getByRole("group", { name: /Risks of a console/ });
  expect(risks).toHaveTextContent("Anyone on the internet can open the console’s sign-in page");
  expect(risks).toHaveTextContent("5 wrong passphrases a minute");
  expect(risks).toHaveTextContent("14 days");
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  expect(api.post).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText(/I understand that anyone on the internet/));
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await screen.findByRole("region", { name: "Prepared setup" });
  const body = vi.mocked(api.post).mock.calls[0]![2] as { configuration: Record<string, unknown> };
  expect(body.configuration.public_console).toBe(true);
  expect(body.configuration).not.toHaveProperty("console_direct");
  expect(body.configuration.console).toEqual({
    origin: "https://eugene.example.org",
    networks: ["0.0.0.0/0", "::/0"],
  });
  // Unticking it asks again next time.
  await user.click(screen.getByRole("checkbox", { name: /Allow the console from any network/ }));
  await user.click(screen.getByRole("checkbox", { name: /Allow the console from any network/ }));
  expect(screen.getByLabelText(/I understand that anyone on the internet/)).not.toBeChecked();
});

it("reads back a console open to any network", () => {
  const read = fieldsFrom({
    proxy: { addresses: ["172.18.0.4"] },
    public_console: true,
    console: { origin: "https://eugene.example.org", networks: ["0.0.0.0/0", "::/0"] },
    workbench: { origin: "https://workbench.example.org", networks: ["0.0.0.0/0", "::/0"] },
  });
  expect(read).toMatchObject({ publicConsole: true, mode: "proxy" });
});

it("keeps the console on its own port by default, with its name for sign-in only", async () => {
  vi.mocked(api.post).mockResolvedValue(PREVIEW);
  render(<AccessSetup />);
  const user = userEvent.setup();
  expect(screen.getByRole("radio", { name: /On its own port, as now/ })).toBeChecked();
  await user.type(screen.getByLabelText(/Base domain/), "example.org");
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
  // No networks needed: nothing it serves is for the console's own network.
  await user.click(screen.getByLabelText(/Allow Workbench access/));
  await user.click(screen.getByRole("button", { name: "Prepare setup" }));
  await screen.findByRole("region", { name: "Prepared setup" });
  const body = vi.mocked(api.post).mock.calls[0]![2] as { configuration: Record<string, unknown> };
  expect(body.configuration.console_direct).toBe(true);
  expect(body.configuration.console).toEqual({
    origin: "https://eugene.example.org",
    networks: [],
  });
  expect(body.configuration).not.toHaveProperty("public_console");
  expect(screen.getByRole("region", { name: "Prepared setup" })).toHaveTextContent(
    "Console: on its own port, as now",
  );
  // The node and inference names still need your networks.
  await user.click(screen.getByLabelText(/Also an inference name/));
  expect(screen.getByLabelText(/Allowed private networks/)).toBeRequired();
});

it("comes back by itself after applying a setup that keeps the console here", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const applied = {
      ...DIRECT,
      active: true,
      restarting: true,
      publicUrls: PREVIEW.publicUrls,
      configuration: { console_direct: true },
      confirmBy: "2026-10-05T12:15:00Z",
    };
    vi.mocked(api.post).mockImplementation(async (_t, path) =>
      path === "/v1/entrypoint/apply" ? applied : PREVIEW,
    );
    render(<AccessSetup />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(/Base domain/), "example.org");
    await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.30.0.2");
    await user.click(screen.getByRole("button", { name: "Prepare setup" }));
    await user.click(await screen.findByRole("button", { name: "Apply…" }));
    expect(screen.getByRole("group", { name: "Apply this setup" })).toHaveTextContent(
      "this page comes back in a few seconds",
    );
    vi.mocked(api.get).mockRejectedValueOnce(new Error("restarting"));
    await user.click(screen.getByRole("button", { name: "Apply and restart" }));
    expect(await screen.findByRole("region", { name: "Restarting" })).toHaveTextContent(
      "The console stays at this address",
    );
    vi.mocked(api.get).mockResolvedValue({
      ...applied,
      restarting: undefined,
      confirmBy: undefined,
    });
    await vi.advanceTimersByTimeAsync(4500);
    expect(await screen.findByRole("region", { name: "In effect" })).toHaveTextContent(
      "One HTTPS port is on for Workbench",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("finds a trusted proxy inside an allowed network, at the network's edges too", () => {
  expect(proxiesInsideNetworks(["172.18.0.4"], ["172.18.0.0/16", "192.168.16.0/24"])).toEqual([
    { proxy: "172.18.0.4", network: "172.18.0.0/16" },
  ]);
  expect(proxiesInsideNetworks(["10.0.0.255"], ["10.0.0.0/24"])).toHaveLength(1);
  expect(proxiesInsideNetworks(["10.0.1.0"], ["10.0.0.0/24"])).toEqual([]);
  expect(proxiesInsideNetworks(["10.0.0.7"], ["10.0.0.7"])).toHaveLength(1);
  expect(proxiesInsideNetworks(["200.1.2.3"], ["0.0.0.0/0"])).toHaveLength(1);
  expect(
    proxiesInsideNetworks(
      ["fd00::1", "nope", "10.0.0.7", "10.0.0.300"],
      ["fd00::/8", "10.0.0.7/33", "10.0.0.7/32/8", "10.0.1.44"],
    ),
  ).toEqual([]);
});

it("warns when the proxy's address is inside the allowed networks (ui #16)", async () => {
  render(<AccessSetup />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Allowed private networks/), "172.18.2.0/24");
  await user.type(screen.getByLabelText(/Trusted proxy IP addresses/), "172.18.0.4");
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText(/Allowed private networks/));
  await user.type(screen.getByLabelText(/Allowed private networks/), "172.18.0.0/16");
  expect(await screen.findByRole("note")).toHaveTextContent(
    "Your proxy, 172.18.0.4, is inside 172.18.0.0/16",
  );
});
