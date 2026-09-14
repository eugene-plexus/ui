"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { api } from "@/lib/api";
import { accentVar, activeScreen, layerOf, NAV_GROUPS, type Screen } from "@/lib/navigation";
import { clearSessionToken } from "@/lib/session";

import { LayerIcon } from "./LayerIcon";
import { LayerMap } from "./LayerMap";
import { ScreenHeader } from "./ScreenHeader";

/**
 * The navigation, shared by every signed-in screen.
 *
 * **Design:** `specs/docs/design/ui-navigation.md`. Before this, each of
 * the seven screens wrote its own header links: 275 lines across seven
 * files, no two alike, `/metrics` and `/nodes` reachable only by going
 * back to a chat screen, and Sign out present on exactly one of them.
 *
 * Two rows, because one row is what produced that. Row 1 is navigation
 * and is identical everywhere; row 2 is the screen's own title and
 * controls. A page can then add a control without having to decide which
 * link to drop.
 *
 * The groups are the architecture page's own two halves — the request
 * path and the three services beside it — rather than one group per
 * layer, which would be a caption on every item.
 */
export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeScreen(pathname);
  const [mapOpen, setMapOpen] = useState(false);
  const mapToggleRef = useRef<HTMLButtonElement | null>(null);
  const mapId = useId();

  const closeMap = useCallback(() => {
    setMapOpen(false);
    mapToggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mapOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMap();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapOpen, closeMap]);

  async function handleLogout() {
    try {
      await api.delete("agent", "/v1/auth/sessions/current");
    } catch {
      // The session is being abandoned either way; a failure to revoke it
      // server-side must not strand the operator on a page they asked to
      // leave.
    }
    clearSessionToken();
    router.push("/login");
  }

  return (
    <>
      {/* First focusable element on every screen. The UI had none before
          this, so a keyboard user tabbed the whole header on every page. */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <nav
        aria-label="Main"
        data-testid="app-nav"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2"
      >
        <Link
          href="/"
          aria-label="Eugene Plexus"
          className="flex shrink-0 items-center gap-2 rounded-[var(--radius)]"
        >
          <Image src="/eugene-icon.svg" alt="" width={24} height={24} priority />
        </Link>

        {NAV_GROUPS.map((group) => (
          <div key={group.side} className="flex flex-wrap items-center gap-2">
            <span
              className="font-ui text-[10px] tracking-[0.14em] text-[color:var(--muted)] uppercase"
              aria-hidden="true"
            >
              {group.label}
            </span>
            <ul className="flex flex-wrap items-center gap-1" aria-label={group.label}>
              {group.screens.map((screen) => (
                <li key={screen.href}>
                  <NavLink screen={screen} active={current?.href === screen.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            ref={mapToggleRef}
            data-testid="layer-map-toggle"
            onClick={() => setMapOpen((open) => !open)}
            aria-expanded={mapOpen}
            aria-controls={mapId}
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            title="The five layers and the three services beside them, and which screen lives where"
          >
            <LayerIcon name="Monitor" size={14} />
            The system
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            data-testid="sign-out"
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
            title="Revoke this session and return to the sign-in screen"
          >
            <LayerIcon name="KeyRound" size={14} />
            Sign out
          </button>
        </div>
      </nav>
      {mapOpen && <LayerMap id={mapId} current={current} onClose={closeMap} />}
    </>
  );
}

function NavLink({ screen, active }: { screen: Screen; active: boolean }) {
  const layer = layerOf(screen.layer);
  return (
    <Link
      href={screen.href}
      aria-current={active ? "page" : undefined}
      data-nav-screen={screen.href}
      data-layer={layer.id}
      title={`${layer.name} — ${screen.blurb}`}
      className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border-b-2 px-2.5 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] ${
        active
          ? "bg-[color:var(--panel-hover)] font-semibold"
          : "border-transparent text-[color:var(--foreground)]"
      }`}
      style={active ? { borderBottomColor: accentVar(layer.accent) } : undefined}
    >
      <LayerIcon name={screen.icon} accent={layer.accent} size={14} />
      {screen.label}
    </Link>
  );
}

/**
 * Both rows at once: the shared navigation, then this screen's own
 * header. Seven pages render exactly this and supply only what is theirs.
 *
 * `href` picks the registry entry, so the icon, the title and the layer
 * breadcrumb cannot drift from the navigation's. `detail` is whatever the
 * screen wants beside its title (a node picker, a model picker, a scan
 * age); `children` are its controls, right-aligned.
 */
export function AppHeader({
  href,
  detail,
  children,
}: {
  href: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <AppNav />
      <ScreenHeader href={href} detail={detail}>
        {children}
      </ScreenHeader>
      {/* Where the skip link lands. An anchor immediately after the two
          header rows rather than an id on each page's own container:
          the seven pages have two different shells (a flex column with a
          fixed header, and an ordinary scrolling document), and this
          works in both without either of them changing. */}
      <div id="main-content" tabIndex={-1} />
    </>
  );
}
