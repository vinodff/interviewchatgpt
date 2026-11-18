import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/(site)/download/[platform]/route";
import { desktopInstallerUrl, desktopPlatformFrom, isDesktopPlatform } from "@/lib/desktop-download";

const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const WINDOWS_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const RELEASE = "https://github.com/vinodff/interviewchatgpt/releases/latest/download";

describe("desktopPlatformFrom", () => {
  it("offers the Windows or Mac installer from the user agent", () => {
    expect(desktopPlatformFrom(WINDOWS_CHROME)).toBe("windows");
    expect(desktopPlatformFrom(WINDOWS_FIREFOX)).toBe("windows");
    expect(desktopPlatformFrom(MAC_SAFARI)).toBe("mac");
  });

  it("offers nothing to phones, Linux or an unknown agent", () => {
    for (const agent of [IPHONE, ANDROID, LINUX, "", null, undefined]) expect(desktopPlatformFrom(agent)).toBeNull();
  });

  it("goes by Chromium's platform hint when there is one", () => {
    expect(desktopPlatformFrom(LINUX, '"Windows"')).toBe("windows");
    expect(desktopPlatformFrom(WINDOWS_CHROME, '"macOS"')).toBe("mac");
    expect(desktopPlatformFrom(LINUX, '"Android"')).toBeNull();
    expect(desktopPlatformFrom(WINDOWS_CHROME, '"Chrome OS"')).toBeNull();
    expect(desktopPlatformFrom(MAC_SAFARI, "")).toBe("mac");
  });
});

describe("installer links", () => {
  it("use the latest GitHub release unless an https URL is configured", () => {
    expect(desktopInstallerUrl("windows", {})).toBe(`${RELEASE}/InterviewWin-Windows-Setup.exe`);
    expect(desktopInstallerUrl("mac", {})).toBe(`${RELEASE}/InterviewWin-Mac.dmg`);
    expect(desktopInstallerUrl("mac", { DESKTOP_MAC_DOWNLOAD_URL: " https://cdn.example.com/InterviewWin.dmg " })).toBe("https://cdn.example.com/InterviewWin.dmg");
    expect(desktopInstallerUrl("windows", { DESKTOP_WINDOWS_DOWNLOAD_URL: "http://cdn.example.com/setup.exe" })).toBe(`${RELEASE}/InterviewWin-Windows-Setup.exe`);
    expect(desktopInstallerUrl("windows", { DESKTOP_MAC_DOWNLOAD_URL: "https://cdn.example.com/InterviewWin.dmg" })).toBe(`${RELEASE}/InterviewWin-Windows-Setup.exe`);
  });

  it("know only Windows and Mac", () => {
    expect(isDesktopPlatform("windows")).toBe(true);
    expect(isDesktopPlatform("mac")).toBe(true);
    for (const value of ["linux", "Mac", "toString", ""]) expect(isDesktopPlatform(value)).toBe(false);
  });

  it("redirect /download/windows and /download/mac, and anything else to the download page", async () => {
    const get = (platform: string) => GET(new NextRequest(`https://www.interviewwin.live/download/${platform}`), { params: Promise.resolve({ platform }) });
    const windows = await get("windows");
    expect(windows.status).toBe(307);
    expect(windows.headers.get("location")).toBe(desktopInstallerUrl("windows", process.env));
    expect((await get("mac")).headers.get("location")).toBe(desktopInstallerUrl("mac", process.env));
    expect((await get("linux")).headers.get("location")).toBe("https://www.interviewwin.live/download");
  });
});
