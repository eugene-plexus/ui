/**
 * The `share_credentials` editor (R2.6).
 *
 * Who this machine says it is when it reaches a file server. It exists
 * because an agent running as a Windows service holds none of the
 * credentials the person who installed it typed into Explorer — so a
 * share that opened yesterday answers `WinError 1272` after the upgrade,
 * with every health check still green.
 *
 * **The defect worth testing is not a failed login.** `GET /v1/config`
 * redacts every password, so every row arrives blank in a field that
 * already has a value on the server. Writing that blank back would clear
 * a secret the install needs — and nothing would say so until the next
 * reboot. The three password states below are the agent's merge rule
 * seen from this side, and they have to agree with it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const FIELD: ConfigField = {
  key: "shareCredentials",
  label: "Logins for file servers",
  category: "storage",
  valueType: "share_credentials",
  sensitive: false,
  required: false,
  requiresRestart: false,
  default: [],
};

function renderField(value: unknown, onChange = vi.fn()) {
  render(<ConfigFieldInput field={FIELD} value={value} pending={false} onChange={onChange} />);
  return onChange;
}

describe("share credentials", () => {
  it("shows an empty list as a sentence rather than an empty box", () => {
    renderField([]);
    expect(screen.getByTestId("share-credentials")).toHaveTextContent("No logins");
  });

  it("marks a stored password as saved rather than as empty", () => {
    // The server redacted it. An empty password box with no explanation
    // invites somebody to "fix" it, and the fix clears the secret.
    renderField([{ host: "192.168.16.252", username: "tcorbin", password: null }]);
    const box = screen.getByLabelText("Password for the file server");
    expect(box).toHaveValue("");
    expect(box).toHaveAttribute("placeholder", expect.stringContaining("saved"));
  });

  it("sends null for an untouched password, which means keep the stored one", () => {
    const onChange = vi.fn();
    renderField([{ host: "nas", username: "old", password: null }], onChange);
    fireEvent.change(screen.getByLabelText("User name on the file server"), {
      target: { value: "new" },
    });
    expect(onChange).toHaveBeenCalledWith([{ host: "nas", username: "new", password: null }]);
  });

  it("sends an empty string only when the person asks to forget it", () => {
    // Explicit, and the only way to clear one. If this sent "" for an
    // untouched row instead, every edit anywhere on the page would
    // silently drop the password.
    const onChange = vi.fn();
    renderField([{ host: "nas", username: "u", password: null }], onChange);
    fireEvent.click(screen.getByTestId("share-forget-0"));
    expect(onChange).toHaveBeenCalledWith([{ host: "nas", username: "u", password: "" }]);
  });

  it("does not offer to forget a password that was never set", () => {
    renderField([]);
    fireEvent.click(screen.getByText("add a server"));
    expect(screen.queryByTestId("share-forget-0")).toBeNull();
  });

  it("sends a typed password as typed", () => {
    const onChange = vi.fn();
    renderField([{ host: "nas", username: "u", password: null }], onChange);
    fireEvent.change(screen.getByLabelText("Password for the file server"), {
      target: { value: "hunter2" },
    });
    expect(onChange).toHaveBeenCalledWith([{ host: "nas", username: "u", password: "hunter2" }]);
  });

  it("keeps a half-typed row out of the patch", () => {
    // The same rule the mappings editor keeps: a row with no server or
    // no user name is a row somebody is still typing, and sending it
    // would come back rejected while they were mid-word.
    const onChange = vi.fn();
    renderField([], onChange);
    fireEvent.click(screen.getByText("add a server"));
    fireEvent.change(screen.getByLabelText("File server"), { target: { value: "nas" } });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("links to where the folder itself is mounted", () => {
    // `cross-link-related-settings`: this field says WHO this machine
    // is on that server; the other half says WHERE the folder is. A
    // half added without its link is a defect.
    renderField([]);
    expect(screen.getByTestId("share-credentials")).toHaveTextContent("Library → Folders");
  });
});
