/**
 * The trust page's steps, per operating system, and which OS this browser is.
 * Plain GUI steps only: never a terminal command (Troy's standing rule).
 */

export type TrustOs = "windows" | "macos" | "ios" | "android" | "chromeos" | "linux";

export const TRUST_OS_ORDER: TrustOs[] = [
  "windows",
  "macos",
  "ios",
  "android",
  "chromeos",
  "linux",
];

/** The OS a browser runs on, from what it says about itself; null when it says nothing usable. */
export function detectOs(
  userAgent: string,
  platform: string = "",
  maxTouchPoints: number = 0,
): TrustOs | null {
  const ua = userAgent.toLowerCase();
  const plat = platform.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  // iPadOS asks for desktop sites and says Macintosh; only a touch screen gives it away.
  if ((/macintosh/.test(ua) || plat === "macintel") && maxTouchPoints > 1) return "ios";
  if (/android/.test(ua)) return "android";
  if (/cros/.test(ua)) return "chromeos";
  if (/windows|win32|win64/.test(ua) || plat.startsWith("win")) return "windows";
  if (/macintosh|mac os x/.test(ua) || plat.startsWith("mac")) return "macos";
  if (/linux|x11/.test(ua) || plat.startsWith("linux")) return "linux";
  return null;
}

/** The detected OS first, then the rest in the usual order. */
export function orderedOs(detected: TrustOs | null): TrustOs[] {
  if (!detected) return [...TRUST_OS_ORDER];
  return [detected, ...TRUST_OS_ORDER.filter((os) => os !== detected)];
}

export interface TrustGuide {
  title: string;
  steps: string[];
  /** A second path for a browser with its own certificate store. */
  firefox?: string[];
  note?: string;
}

const FIREFOX = [
  "In Firefox, open Settings, then Privacy & Security.",
  "Under Certificates, choose View Certificates, then the Authorities tab.",
  "Choose Import, pick the downloaded file, and tick Trust this CA to identify websites.",
];

export const TRUST_GUIDES: Record<TrustOs, TrustGuide> = {
  windows: {
    title: "Windows",
    steps: [
      "Open the downloaded file and choose Install Certificate.",
      "Choose Current User, then Next.",
      "Choose Place all certificates in the following store, then Browse.",
      "Pick Trusted Root Certification Authorities, then OK and Next.",
      "Choose Finish, then Yes.",
      "Restart the browser.",
    ],
    firefox: FIREFOX,
  },
  macos: {
    title: "macOS",
    steps: [
      "Open the downloaded file. Keychain Access adds it.",
      "Double-click the Eugene Plexus CA entry and open Trust.",
      "Set When using this certificate to Always Trust.",
      "Close the window and enter your password.",
      "Restart the browser.",
    ],
    firefox: FIREFOX,
  },
  ios: {
    title: "iPhone and iPad",
    steps: [
      "Open the download in Safari and choose Allow.",
      "Open Settings, then Profile Downloaded, then Install.",
      "Open Settings, then General, then About, then Certificate Trust Settings.",
      "Turn on Eugene Plexus.",
    ],
  },
  android: {
    title: "Android",
    steps: [
      "Open Settings, then Security & privacy, then More security settings.",
      "Choose Encryption & credentials, then Install a certificate, then CA certificate.",
      "Choose Install anyway, then pick the downloaded file.",
    ],
    note: "Chrome trusts it. Many other apps don't.",
  },
  chromeos: {
    title: "ChromeOS",
    steps: [
      "In Chrome, open Settings, then Privacy and security, then Security.",
      "Choose Manage certificates, then the Authorities tab, then Import.",
      "Pick the downloaded file and tick Trust this certificate for identifying websites.",
    ],
    firefox: FIREFOX,
  },
  linux: {
    title: "Linux",
    steps: [
      "In Chrome, open Settings, then Privacy and security, then Security.",
      "Choose Manage certificates, then the Authorities tab, then Import.",
      "Pick the downloaded file and tick Trust this certificate for identifying websites.",
    ],
    firefox: FIREFOX,
  },
};
