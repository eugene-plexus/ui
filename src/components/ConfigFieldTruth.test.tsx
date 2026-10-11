/**
 * Settings never lie (Troy, 2026-09-29: fundamental).
 *
 * No widget may show a value other than the one in effect. Found on Troy's
 * worker: an unset `updateChannel` read **Edge** while the agent followed
 * releases, because a `<select>` whose value matches no option shows its
 * first one.
 *
 * **Every body here is one a component really serves.** `settings-wire.json`
 * is captured from each component's own code (specs
 * `docs/acceptance/settings-accuracy-run.md` says how), so these tests fail
 * if a component and this page stop agreeing about what a field says -- not
 * only if this page regresses against a fixture it invented.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import wire from "@/lib/__fixtures__/settings-wire.json";
import type { ConfigField } from "@/lib/types";

type Case = { field: ConfigField; value: unknown };
const cases = wire as unknown as Record<string, Record<string, Case>>;

function show(component: string, name: string, overrides: { value?: unknown } = {}) {
  const found = cases[component]?.[name];
  if (!found) throw new Error(`no captured case ${component}/${name}`);
  const value = "value" in overrides ? overrides.value : found.value;
  const onChange = vi.fn();
  render(
    <ConfigFieldInput
      field={found.field}
      value={value}
      savedValue={value}
      pending={false}
      onChange={onChange}
    />,
  );
  return { field: found.field, onChange };
}

describe("an unset value says what it does", () => {
  it("a container's default says where it comes from", () => {
    show("agent", "updateChannel_container");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Edge");
    expect(screen.getByTestId("default-updateChannel")).toHaveTextContent(
      "EUGENE_PLEXUS_AGENT_DEFAULT_UPDATE_CHANNEL",
    );
  });

  it("an empty engine path is what PATH finds", () => {
    show("agent", "vllmBinary_on_path");
    expect(screen.getByTestId("unset-vllmBinary")).toHaveTextContent("/opt/vllm/bin/vllm");
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "/opt/vllm/bin/vllm");
  });

  it("no output cap is said, not a blank box", () => {
    show("gateway", "defaultMaxTokens");
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(screen.getByTestId("unset-defaultMaxTokens")).toHaveTextContent("No cap");
  });

  it("an empty origin list is any website, not 'none'", () => {
    show("gateway", "corsAllowedOrigins");
    expect(screen.getByText(/any website may call/)).toBeInTheDocument();
    expect(screen.getByTestId("default-corsAllowedOrigins")).not.toHaveTextContent("none");
    // And not the control root's standby sentence, which it used to borrow.
    expect(screen.queryByText(/standby/i)).toBeNull();
  });

  it("an unset control root address names the one in use", () => {
    show("gateway", "controlUrl");
    expect(screen.getByTestId("unset-controlUrl")).toHaveTextContent("192.168.16.252:8283");
  });

  it("an empty standby list says so in the control root's own words", () => {
    show("control", "standbyUrls");
    expect(screen.getByText(/No standbys/)).toBeInTheDocument();
  });

  it("a key from the environment is named, and no key is shown saved", () => {
    show("inference-driver", "apiKey");
    expect(screen.getByTestId("unset-apiKey")).toHaveTextContent("OPENAI_API_KEY");
    expect(screen.queryByText(/Saved and hidden/)).toBeNull();
  });

  it("an unset address is the provider's own", () => {
    show("inference-driver", "baseUrl");
    expect(screen.getByTestId("unset-baseUrl")).toHaveTextContent("openrouter.ai");
  });

  it("an unset hub token says what it does", () => {
    show("library", "hfToken_unset");
    expect(screen.getByTestId("unset-hfToken")).toHaveTextContent("anonymously");
  });

  it("the environment's default folders say where they come from", () => {
    show("library", "modelRoots_env_default");
    expect(screen.getByTestId("default-modelRoots")).toHaveTextContent(
      "EUGENE_PLEXUS_LIBRARY_DEFAULT_MODEL_ROOTS",
    );
  });
});

describe("what a value is doing is said", () => {
  it("a mode this machine cannot carry out warns", () => {
    show("agent", "securityMode_unusable");
    expect(screen.getByTestId("status-securityMode")).toHaveTextContent("every start");
    show("control", "securityMode");
    expect(screen.getAllByTestId("status-securityMode")[1]).toHaveTextContent("comes back locked");
  });

  it("a saved value not yet in effect says what runs meanwhile", () => {
    show("gateway", "metricsRetentionDays_pending");
    expect(screen.getByRole("spinbutton")).toHaveValue(30);
    expect(screen.getByTestId("pending-metricsRetentionDays")).toHaveTextContent(
      "runs on 7 until it restarts",
    );
  });

  it("a field the agent manages is shown, not edited", () => {
    show("inference-driver", "provider");
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByTestId("managed-provider")).toHaveTextContent("agent");
    expect(screen.getByTestId("pending-provider")).toBeInTheDocument();
  });

  it("a share login says whether a password is stored", () => {
    show("agent", "shareCredentials_rows");
    const boxes = screen.getAllByLabelText("Password for the file server");
    expect(boxes[0]).toHaveAttribute("placeholder", "saved - leave blank to keep it");
    expect(boxes[1]).toHaveAttribute("placeholder", "no password saved");
  });
});

describe("a value the widget cannot show is shown as itself", () => {
  it("an enum value that is not a choice is not drawn as the first choice", () => {
    const { onChange } = show("agent", "updateChannel_container", { value: "beta" });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('"beta" (not one of the choices)');
    expect(screen.getByTestId("value-warning-updateChannel")).toHaveTextContent('"beta"');
    fireEvent.change(select, { target: { value: "releases" } });
    expect(onChange).toHaveBeenLastCalledWith("releases");
  });

  it("a number box never goes blank over a string", () => {
    show("gateway", "metricsRetentionDays_pending", { value: "seven" });
    expect(screen.getByTestId("value-warning-metricsRetentionDays")).toHaveTextContent(
      "not a number",
    );
  });

  it("a number outside the range is shown, and said", () => {
    show("gateway", "metricsRetentionDays_pending", { value: 900 });
    expect(screen.getByRole("spinbutton")).toHaveValue(900);
    expect(screen.getByTestId("value-warning-metricsRetentionDays")).toHaveTextContent("0 to 365");
  });

  it("a checkbox holding a string is half-set, not on", () => {
    const field: ConfigField = {
      key: "metricsEnabled",
      label: "Keep request metrics",
      category: "metrics",
      valueType: "boolean",
      default: true,
      sensitive: false,
      required: false,
      requiresRestart: true,
      pendingRestart: false,
    };
    render(<ConfigFieldInput field={field} value="false" pending={false} onChange={vi.fn()} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByTestId("value-warning-metricsEnabled")).toHaveTextContent("not on or off");
  });

  it("a null checkbox with a default shows the default and says it is unset", () => {
    const field: ConfigField = {
      key: "corsEnabled",
      label: "Allow browsers",
      category: "clients",
      valueType: "boolean",
      default: true,
      sensitive: false,
      required: false,
      requiresRestart: false,
      pendingRestart: false,
    };
    render(<ConfigFieldInput field={field} value={null} pending={false} onChange={vi.fn()} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("unset-corsEnabled")).toHaveTextContent("uses the default, on");
  });

  it("entries a list editor cannot read are counted, not dropped silently", () => {
    show("gateway", "corsAllowedOrigins", { value: ["http://a:1", { oops: 1 }] });
    expect(screen.getByTestId("value-warning-corsAllowedOrigins")).toHaveTextContent(
      "1 entry here could not be read",
    );
    expect(screen.queryByDisplayValue("[object Object]")).toBeNull();
  });
});
