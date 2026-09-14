"use client";

import {
  Cloud,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  KeyRound,
  Monitor,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import { accentVar, type AccentRole, type IconName } from "@/lib/navigation";

/**
 * One icon from the architecture page, in one of the layer colours.
 *
 * `lucide-react` at the same version the website pins for `@lucide/astro`
 * (1.45.0), imported by name so the bundle carries these eleven and not
 * the set. Before this the UI had no icon library and no inline `<svg>` at
 * all — the only image asset was the background mark.
 *
 * **`data-icon` is ours, and the tests assert on it, not on lucide's own
 * class names.** A third party's `class="lucide lucide-terminal"` is an
 * implementation detail it may rename; the contract this project cares
 * about is "the Inference item wears the icon the website gives inference
 * drivers", so that contract gets an attribute of its own.
 *
 * Colour is applied as an inline `color` from a CSS custom property
 * rather than a Tailwind class, because the role→token mapping lives in
 * `navigation.ts` and a class name would be a second copy of it. The
 * token varies per theme; the icon does not, which is why the icon is the
 * identity and the colour is the echo.
 */
const ICONS: Record<IconName, LucideIcon> = {
  Terminal,
  Radio,
  Cpu,
  Cloud,
  HardDrive,
  Server,
  Database,
  ShieldCheck,
  Monitor,
  FolderOpen,
  KeyRound,
};

export function LayerIcon({
  name,
  accent,
  size = 16,
  className,
}: {
  name: IconName;
  /** Omit to inherit the surrounding text colour. */
  accent?: AccentRole;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name];
  return (
    <Icon
      size={size}
      aria-hidden="true"
      data-icon={name}
      className={className}
      style={accent ? { color: accentVar(accent) } : undefined}
    />
  );
}
