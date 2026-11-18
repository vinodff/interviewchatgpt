/** The InterviewWin desktop app: which installer suits a visitor's computer, and where each one is published. */
export type DesktopPlatform = "windows" | "mac";

export const DESKTOP_APPS: Record<DesktopPlatform, { name: string; file: string; requires: string }> = {
  windows: { name: "Windows", file: "InterviewWin-Windows-Setup.exe", requires: "Windows 10 or 11, 64-bit" },
  mac: { name: "Mac", file: "InterviewWin-Mac.dmg", requires: "macOS 13 Ventura or later, Apple silicon or Intel" },
};

// The "Desktop release" GitHub workflow attaches both files to each release under these exact names.
const LATEST_RELEASE = "https://github.com/vinodff/interviewchatgpt/releases/latest/download";
const URL_OVERRIDES: Record<DesktopPlatform, string> = { windows: "DESKTOP_WINDOWS_DOWNLOAD_URL", mac: "DESKTOP_MAC_DOWNLOAD_URL" };

export function isDesktopPlatform(value: string): value is DesktopPlatform {
  return Object.hasOwn(DESKTOP_APPS, value);
}

/**
 * The installer this computer can run, from the User-Agent or, when the browser sends it, Chromium's
 * Sec-CH-UA-Platform hint. Phones, tablets, Linux and ChromeOS get null: there is no app for them.
 */
export function desktopPlatformFrom(userAgent?: string | null, platformHint?: string | null): DesktopPlatform | null {
  const hint = platformHint?.replace(/"/g, "").trim().toLowerCase();
  if (hint) return hint === "windows" ? "windows" : hint === "macos" ? "mac" : null;
  const agent = userAgent || "";
  if (/iphone|ipad|ipod|android|mobile/i.test(agent)) return null;
  if (/windows nt/i.test(agent)) return "windows";
  return /macintosh|mac os x/i.test(agent) ? "mac" : null;
}

/** Where /download/<platform> sends the browser: an https URL from the environment, else the latest release. */
export function desktopInstallerUrl(platform: DesktopPlatform, env: Record<string, string | undefined>): string {
  const override = env[URL_OVERRIDES[platform]]?.trim();
  return override?.startsWith("https://") ? override : `${LATEST_RELEASE}/${DESKTOP_APPS[platform].file}`;
}
