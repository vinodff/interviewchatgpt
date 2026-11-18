import Link from "next/link";
import { ArrowRight, AudioLines, Info, Keyboard, PictureInPicture2, ScanText, Smartphone } from "lucide-react";
import { DESKTOP_APPS, type DesktopPlatform } from "@/lib/desktop-download";
import { DesktopDownloadOptions } from "./desktop-download";
import { PlatformIcon } from "./platform-icons";
import { PageIntro } from "./site-pages";
import { SiteCta } from "./site-shell";

const benefits = [
  { icon: AudioLines, title: "Hears the call itself", text: "Picks up the interviewer from Zoom, Meet, Teams or any call app through your computer’s audio, along with your microphone." },
  { icon: ScanText, title: "Answers what’s on screen", text: "Analyze reads a coding problem or a question on a shared slide and answers it in the same window." },
  { icon: PictureInPicture2, title: "Stays on top of the call", text: "A compact answer card floats above your other apps. Drag it anywhere, and change its text size and opacity." },
  { icon: Keyboard, title: "Works from the keyboard", text: "Answer the latest question, run Analyze, or flip between a quick glance and the full answer with shortcuts." },
];

const installSteps: Record<DesktopPlatform, string[]> = {
  windows: [
    `Open ${DESKTOP_APPS.windows.file} from your downloads.`,
    "If Windows shows “Windows protected your PC”, choose More info, then Run anyway.",
    "Finish the installer, open InterviewWin from the Start menu, and sign in.",
  ],
  mac: [
    `Open ${DESKTOP_APPS.mac.file} and drag InterviewWin into Applications.`,
    "Open InterviewWin. If macOS says it can’t check the app, go to System Settings → Privacy & Security and choose Open Anyway.",
    "Sign in, then allow the microphone and screen recording when macOS asks.",
  ],
};

/** /download: both installers (this computer's first), what the app adds, and how to install it. */
export function DesktopDownloadPage({ platform }: { platform: DesktopPlatform | null }) {
  return <>
    <PageIntro eyebrow="THE DESKTOP APP" title="Your answers, right beside the call." description="InterviewWin for Windows and Mac keeps a small answer window on top of your call. It hears the interviewer through your computer’s audio and uses the same account and minutes as the website." />
    <section className="landing-container download-section" aria-label="Downloads" data-reveal><DesktopDownloadOptions platform={platform} /></section>
    <section className="landing-container download-benefits" aria-labelledby="download-benefits-title">
      <div className="download-heading" data-reveal><p className="eyebrow">WHAT THE APP ADDS</p><h2 id="download-benefits-title">More than a browser tab can hear.</h2></div>
      <div className="download-benefit-grid">{benefits.map(({ icon: Icon, title, text }, index) => <article key={title} data-reveal data-reveal-delay={index * 60}><div className="feature-icon"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /></div><h3>{title}</h3><p>{text}</p></article>)}</div>
      <p className="download-footnote"><Info size={16} aria-hidden="true" /> System audio needs Windows, or macOS 15 or later. On an older Mac, play the call through your speakers so the microphone can hear it.</p>
    </section>
    <section className="landing-container download-install" aria-labelledby="download-install-title">
      <h2 id="download-install-title" data-reveal>Install in a minute.</h2>
      <div className="download-install-grid">{(Object.keys(installSteps) as DesktopPlatform[]).map((key, index) => <article key={key} data-reveal data-reveal-delay={index * 60}><h3><PlatformIcon platform={key} size={20} /> {DESKTOP_APPS[key].name}</h3><ol>{installSteps[key].map(step => <li key={step}>{step}</li>)}</ol></article>)}</div>
    </section>
    <section className="landing-container device-note" data-reveal><Smartphone size={28} aria-hidden="true" /><div><h2>On a phone or tablet?</h2><p>The desktop app is for Windows and Mac computers. On your phone, InterviewWin works right in the browser. Open this page on your computer when you’re ready to install.</p></div><Link href="/interview?view=live" className="landing-secondary">Use it in the browser <ArrowRight size={16} /></Link></section>
    <SiteCta />
  </>;
}
