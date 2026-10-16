"use client";

import { useCallback, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/control";
import { usePolling } from "@/lib/usePolling";
import { ConfirmButton } from "./ConfirmButton";
import { CopyButton } from "./CopyButton";
import { PersonSection } from "./PersonSection";

type Provider = components["schemas"]["ExternalProvider"];
type ProviderWrite = components["schemas"]["ExternalProviderWrite"];
type SignIn = components["schemas"]["PersonSignIn"];
type Invitation = components["schemas"]["SignInInvitationCreated"];
const button =
  "action-button self-start rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm disabled:opacity-40";
const input =
  "mt-1 w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm";
const personalTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";

export function ExternalSignIn() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="section-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpen(true);
      }}
    >
      <summary className="cursor-pointer text-lg font-semibold">External sign-in</summary>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Let invited people use Google, Microsoft or your identity provider. Local passwords remain
        available.
      </p>
      {open && <Providers />}
    </details>
  );
}

function Providers() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [issuer, setIssuer] = useState("");
  const [managedIssuer, setManagedIssuer] = useState("");
  const [explicitIssuer, setExplicitIssuer] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [editing, setEditing] = useState<Provider | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [list, config] = await Promise.all([
        api.get<components["schemas"]["ExternalProviderList"]>("control", "/v1/auth/providers"),
        api.get<{ oidcIssuer?: string | null }>("control", "/v1/config"),
      ]);
      setProviders(list.providers);
      setIssuer(list.signInAddress || config.oidcIssuer || "");
      setManagedIssuer(list.managedSignInAddress || "");
      setExplicitIssuer(config.oidcIssuer || "");
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);
  usePolling(load, 10_000);
  return (
    <div className="mt-5 flex flex-col gap-5 text-sm">
      <div className="rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-4">
        <h3 className="font-semibold">1. Eugene’s sign-in address</h3>
        <p className="my-2 text-[color:var(--muted)]">
          {managedIssuer && !explicitIssuer
            ? "Set automatically from Container access setup. There is no extra port or proxy host to configure."
            : "Use the Eugene console’s HTTPS hostname with /oidc. With Nginx Proxy Manager this normally uses port 443, without a port number in the address. Workbench has its own hostname."}
        </p>
        {managedIssuer && <code className="block break-all">{issuer}</code>}
        {managedIssuer && explicitIssuer && issuer !== managedIssuer && (
          <p className="mt-2 text-[color:var(--muted)]">
            Your saved address is kept. Access setup suggests {managedIssuer}.
          </p>
        )}
        <details open={managedIssuer ? undefined : true} className="mt-3">
          <summary className="cursor-pointer">
            {managedIssuer ? "Advanced: override the sign-in address" : "Set the sign-in address"}
          </summary>
          <p className="my-2 text-[color:var(--muted)]">
            Changing an existing address requires updating apps and provider callback registrations
            that use it.
          </p>
          <label>
            Eugene sign-in address
            <input
              type="url"
              className={input}
              placeholder="https://eugene.example.com/oidc"
              value={address ?? issuer}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={button}
              disabled={busy || !(address ?? issuer).trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.patch("control", "/v1/config", {
                    oidcIssuer: (address ?? issuer).trim().replace(/\/$/, ""),
                  });
                  await load();
                  setAddress(null);
                } catch (e) {
                  setError(describeError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save sign-in address
            </button>
            <button className={button} onClick={() => setAddress(window.location.origin + "/oidc")}>
              Use this address
            </button>
            {managedIssuer && explicitIssuer && (
              <button
                className={button}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.patch("control", "/v1/config", { oidcIssuer: null });
                    await load();
                    setAddress(null);
                  } catch (e) {
                    setError(describeError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use access setup address
              </button>
            )}
          </div>
        </details>
        {issuer && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span>Callback URL:</span>
            <code className="break-all">{issuer.replace(/\/$/, "")}/external/callback</code>
            <CopyButton
              label="Copy callback URL"
              text={issuer.replace(/\/$/, "") + "/external/callback"}
            />
          </div>
        )}
      </div>
      <div>
        <h3 className="font-semibold">2. Connect a provider</h3>
        <p className="mt-2 text-[color:var(--muted)]">
          Register a web application with your provider using the callback URL above, then enter its
          client ID and secret. Enable it when ready.
        </p>
        <p className="mt-2 flex flex-wrap gap-4">
          <a
            className="underline"
            href="https://developers.google.com/identity/openid-connect/openid-connect"
            target="_blank"
            rel="noreferrer"
          >
            Google setup
          </a>
          <a
            className="underline"
            href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc"
            target="_blank"
            rel="noreferrer"
          >
            Microsoft setup
          </a>
        </p>
      </div>
      {providers.map((provider) => (
        <div
          key={provider.id}
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[color:var(--border)] p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{provider.name}</p>
            <p className="break-all text-[color:var(--muted)]">{provider.issuer}</p>
          </div>
          <span className={provider.enabled ? "status-success" : "status-warn"}>
            {provider.enabled ? "Enabled" : "Disabled"}
          </span>
          <button className={button} onClick={() => setEditing(provider)}>
            Edit {provider.name}
          </button>
          <ConfirmButton
            className={button}
            label="Remove"
            ariaLabel={`Remove provider ${provider.name}`}
            prompt="This disconnects its linked accounts and ends their provider sign-ins. Local passwords remain available."
            onConfirm={async () => {
              try {
                await api.delete("control", `/v1/auth/providers/${provider.id}`);
                await load();
              } catch (e) {
                setError(describeError(e));
              }
            }}
          />
        </div>
      ))}
      {editing ? (
        <ProviderEditor
          key={editing === "new" ? "new" : editing.id}
          provider={editing === "new" ? undefined : editing}
          configured={!!issuer}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button className={button} onClick={() => setEditing("new")}>
          Add sign-in provider
        </button>
      )}
      <p className="text-[color:var(--muted)]">
        3. Open a person’s account and create an invitation under Sign-in and sessions. Only invited
        accounts can connect; an email match never grants access.
      </p>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ProviderEditor({
  provider,
  configured,
  onSaved,
  onCancel,
}: {
  provider?: Provider;
  configured: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ProviderWrite["kind"]>(provider?.kind ?? "google");
  const [name, setName] = useState(provider?.name ?? "Google");
  const [issuer, setIssuer] = useState(provider?.issuer ?? "https://accounts.google.com");
  const [tenant, setTenant] = useState(
    provider?.kind === "microsoft" ? (provider.issuer.split("/")[3] ?? "") : "",
  );
  const [clientId, setClientId] = useState(provider?.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [method, setMethod] = useState<ProviderWrite["tokenAuthMethod"]>(
    provider?.tokenAuthMethod ?? "client_secret_post",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="section-inset flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const body: ProviderWrite = {
          name,
          kind,
          issuer:
            kind === "microsoft"
              ? `https://login.microsoftonline.com/${tenant.toLowerCase()}/v2.0`
              : issuer,
          clientId,
          enabled,
          tokenAuthMethod: method,
          ...(secret ? { clientSecret: secret } : {}),
        };
        try {
          if (provider) await api.put("control", `/v1/auth/providers/${provider.id}`, body);
          else await api.post("control", "/v1/auth/providers", body);
          setSecret("");
          await onSaved();
        } catch (e) {
          setError(describeError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">
        {provider ? `Edit ${provider.name}` : "New sign-in provider"}
      </h3>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label>
          Provider
          <select
            className={input}
            disabled={!!provider}
            value={kind}
            onChange={(e) => {
              const next = e.target.value as ProviderWrite["kind"];
              setKind(next);
              setName(next === "oidc" ? "" : next === "google" ? "Google" : "Microsoft");
              setIssuer(next === "google" ? "https://accounts.google.com" : "");
              setMethod(next === "oidc" ? "client_secret_basic" : "client_secret_post");
            }}
          >
            <option value="google">Google</option>
            <option value="microsoft">Microsoft</option>
            <option value="oidc">OpenID Connect</option>
          </select>
        </label>
        <label>
          Button label
          <input
            className={input}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {kind === "microsoft" ? (
          <div className="sm:col-span-2">
            <label>
              Microsoft tenant ID
              <input
                className={input}
                required
                readOnly={!!provider}
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="Directory (tenant) ID from your app registration"
              />
            </label>
            {!provider && (
              <button
                type="button"
                className={`${button} mt-2`}
                onClick={() => setTenant(personalTenant)}
              >
                Use personal Microsoft accounts
              </button>
            )}
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              Choose a specific organization or personal Microsoft accounts. Add a separate provider
              for another tenant.
            </p>
          </div>
        ) : (
          <label className="sm:col-span-2">
            Provider issuer
            <input
              type="url"
              className={input}
              required
              readOnly={kind === "google" || !!provider}
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://auth.example.com/realms/eugene"
            />
          </label>
        )}
        <label>
          Client ID
          <input
            className={input}
            required
            readOnly={!!provider}
            maxLength={512}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            autoComplete="new-password"
            className={input}
            required={!provider}
            maxLength={4096}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={provider?.hasSecret ? "Leave blank to keep the saved secret" : ""}
          />
        </label>
        {kind === "oidc" && (
          <label>
            Client-secret method
            <select
              className={input}
              value={method}
              onChange={(e) => setMethod(e.target.value as ProviderWrite["tokenAuthMethod"])}
            >
              <option value="client_secret_basic">HTTP Basic</option>
              <option value="client_secret_post">Request body</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Offer this sign-in provider
        </label>
      </fieldset>
      {enabled && !configured && (
        <p className="status-warn">
          Save Eugene’s sign-in address above before enabling a provider.
        </p>
      )}
      {provider && (
        <p className="text-xs text-[color:var(--muted)]">
          Saving ends this provider’s current Eugene sessions. Add a new provider to change its
          issuer, tenant or client ID.
        </p>
      )}
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className={button} disabled={busy || (enabled && !configured)}>
          {busy ? "Saving…" : "Save provider"}
        </button>
        <button type="button" className={button} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PersonSignIn({ personId }: { personId: string }) {
  const [data, setData] = useState<SignIn | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/v1/people/${encodeURIComponent(personId)}/sign-in`;
  const load = useCallback(async () => {
    try {
      const [person, list] = await Promise.all([
        api.get<SignIn>("control", path),
        api.get<{ providers: Provider[] }>("control", "/v1/auth/providers"),
      ]);
      setData(person);
      setProviders(list.providers);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [path]);
  usePolling(load, 10_000);
  async function remove(table: string, id: string) {
    setBusy(true);
    try {
      await api.delete("control", `${path}/${table}/${id}`);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PersonSection title="Sign-in and sessions">
      <p className="text-sm text-[color:var(--muted)]">
        Local password sign-in stays available. Connecting a provider preserves this person’s chats,
        groups and permissions.
      </p>
      {data && (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3 text-sm">
            <h4 className="font-semibold">Connected accounts</h4>
            {!data.identities.length && (
              <p className="text-[color:var(--muted)]">No external accounts connected.</p>
            )}
            {data.identities.map((identity) => (
              <div key={identity.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {providers.find((p) => p.id === identity.providerId)?.name ?? "Provider"}
                </span>
                <ConfirmButton
                  disabled={busy}
                  className={button}
                  label="Disconnect"
                  prompt="This ends sign-ins using this provider. The person can use their local password."
                  onConfirm={() => remove("identities", identity.id)}
                />
              </div>
            ))}
            <label>
              Invite through
              <select
                className={input}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a provider</option>
                {providers
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className={button}
              disabled={busy || !selected || !!invitation}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  setInvitation(
                    await api.post<Invitation>("control", path + "/invitations", {
                      providerId: selected,
                    }),
                  );
                  await load();
                } catch (e) {
                  setError(describeError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create sign-in invitation
            </button>
            {invitation && (
              <div className="section-inset flex flex-col gap-3">
                <p>
                  Share this address and one-time code privately with this person. The code is shown
                  once and expires in 24 hours.
                </p>
                <a href={invitation.url} className="break-all underline">
                  {invitation.url}
                </a>
                <code className="break-all">{invitation.code}</code>
                <CopyButton
                  label="Copy sign-in invitation"
                  text={`${invitation.url}\nInvitation code: ${invitation.code}`}
                />
                <button className={button} onClick={() => setInvitation(null)}>
                  I have copied the invitation
                </button>
              </div>
            )}
            {data.invitations.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-2">
                <span>Invitation expires {new Date(entry.expiresAt * 1000).toLocaleString()}</span>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void remove("invitations", entry.id)}
                >
                  Revoke invitation
                </button>
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-3 text-sm">
            <h4 className="font-semibold">Active browser sign-ins</h4>
            {!data.sessions.length && (
              <p className="text-[color:var(--muted)]">
                No active shared sign-ins. Sessions created before this update are not listed.
              </p>
            )}
            {data.sessions.map((session) => (
              <div key={session.id} className="section-inset flex min-w-0 flex-col gap-2">
                <p className="break-words">{session.label}</p>
                <p className="text-xs text-[color:var(--muted)]">
                  Started {new Date(session.authAt * 1000).toLocaleString()} · Ends{" "}
                  {new Date(session.expiresAt * 1000).toLocaleString()}
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void remove("sessions", session.id)}
                >
                  End sign-in
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
    </PersonSection>
  );
}
