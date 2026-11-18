"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Download, MonitorDown } from "lucide-react";
import { DESKTOP_APPS, desktopPlatformFrom, type DesktopPlatform } from "@/lib/desktop-download";
import { PlatformIcon } from "./platform-icons";

const noSubscription = () => () => {};

function browserPlatform(): DesktopPlatform | null {
  const { maxTouchPoints, userAgent, userAgentData } = navigator as Navigator & { userAgentData?: { platform?: string } };
  // iPadOS Safari presents itself as a Mac; only the touch screen tells them apart.
  if (maxTouchPoints > 1 && /macintosh/i.test(userAgent)) return null;
  return desktopPlatformFrom(userAgent, userAgentData?.platform);
}

/** The server's guess from the request while hydrating, then what the browser itself reports. */
function useDesktopPlatform(fromRequest: DesktopPlatform | null): DesktopPlatform | null {
  return useSyncExternalStore(noSubscription, browserPlatform, () => fromRequest);
}

type ButtonProps = { platform: DesktopPlatform | null; className?: string; iconClassName?: string };

/** "Download for Windows" or "Download for Mac" to match this computer; other devices go to the download page. */
export function DesktopDownloadButton({ platform: fromRequest, className, iconClassName }: ButtonProps) {
  const platform = useDesktopPlatform(fromRequest);
  if (!platform) return <Link href="/download" className={className}><span className={iconClassName}><MonitorDown size={14} aria-hidden="true" /></span> Get the desktop app</Link>;
  return <a href={`/download/${platform}`} className={className}><span className={iconClassName}><PlatformIcon platform={platform} size={14} /></span> Download for {DESKTOP_APPS[platform].name}</a>;
}

/** Both installers, with this computer's listed first and highlighted. */
export function DesktopDownloadOptions({ platform: fromRequest }: { platform: DesktopPlatform | null }) {
  const current = useDesktopPlatform(fromRequest);
  const order: DesktopPlatform[] = current === "mac" ? ["mac", "windows"] : ["windows", "mac"];
  return <div className="download-options">{order.map(platform => {
    const app = DESKTOP_APPS[platform];
    const here = platform === current;
    return <article key={platform} className={here ? "download-card download-card-current" : "download-card"}>
      <div className="download-card-top"><span className="download-card-icon"><PlatformIcon platform={platform} size={28} /></span>{here && <span className="download-card-badge">For this computer</span>}</div>
      <h2>{app.name}</h2>
      <p>{app.requires}</p>
      <a href={`/download/${platform}`} className={here ? "button button-primary" : "button button-secondary"}><Download size={17} aria-hidden="true" /> Download for {app.name}</a>
      <small>Free · {app.file}</small>
    </article>;
  })}</div>;
}
