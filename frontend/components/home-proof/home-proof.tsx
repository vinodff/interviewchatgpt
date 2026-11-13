import type { CSSProperties, ReactNode } from "react";
import { Boxes, Building2, Code2, Laptop, MonitorSmartphone, Repeat2, Smartphone, Sparkles, Timer, Video, Zap, Brain, FileText, Layers } from "lucide-react";
import { COMPANIES } from "@/lib/companies";
import { BRAND_MARKS } from "@/lib/brand-marks";
import "./home-proof.css";

/** Infinite marquee: the list is rendered twice and the track slides by exactly one copy. */
function Marquee({ children, seconds, reverse = false, label }: { children: ReactNode; seconds: number; reverse?: boolean; label: string }) {
  return (
    <div className={`hp-marquee ${reverse ? "hp-marquee--reverse" : ""}`} style={{ "--hp-duration": `${seconds}s` } as CSSProperties} role="region" aria-label={label}>
      <div className="hp-track">
        <div className="hp-set">{children}</div>
        <div className="hp-set" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

type Brand = { name: string; slug?: string; color: string };

/** Real brand mark when one is available; otherwise a brand-coloured monogram tile. */
function BrandLogo({ name, slug, color, size }: Brand & { size: number }) {
  const mark = slug ? BRAND_MARKS[slug] : undefined;
  if (mark) return <svg className="hp-logo" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={name}><path fill="currentColor" d={mark.path} /></svg>;
  const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).map(word => word[0]).join("").slice(0, 2).toUpperCase();
  return <span className="hp-monogram" role="img" aria-label={name} style={{ "--hp-brand": color, width: size, height: size, fontSize: size * .42 } as CSSProperties}>{initials}</span>;
}

const PLATFORMS: Brand[] = [
  { name: "Zoom", slug: "zoom", color: "#0B5CFF" },
  { name: "Google Meet", slug: "googlemeet", color: "#00897B" },
  { name: "Microsoft Teams", color: "#5059C9" },
  { name: "Webex", slug: "webex", color: "#00A0D1" },
  { name: "Slack Huddles", color: "#611F69" },
  { name: "Skype", color: "#00AFF0" },
];
const CODING_PLATFORMS: Brand[] = [
  { name: "HackerRank", slug: "hackerrank", color: "#00EA64" },
  { name: "LeetCode", slug: "leetcode", color: "#FFA116" },
  { name: "CoderPad", color: "#3F6BF2" },
  { name: "Codility", color: "#2B2D42" },
  { name: "HackerEarth", slug: "hackerearth", color: "#2C3454" },
  { name: "CodeSignal", slug: "codesignal", color: "#1062FB" },
];

function PlatformChip(brand: Brand) {
  return <span className="hp-platform" style={{ "--hp-brand": brand.color } as CSSProperties}><span className="hp-platform-icon"><BrandLogo {...brand} size={24} /></span>{brand.name}</span>;
}

/** Works next to any call or coding platform: capture is the microphone (plus tab audio on desktop). */
export function HomePlatforms() {
  return (
    <section className="hp-section hp-platforms" aria-labelledby="hp-platforms-title">
      <div className="landing-container hp-head hp-reveal">
        <p className="hp-kicker"><MonitorSmartphone size={14} aria-hidden="true" /> Works where you interview</p>
        <h2 id="hp-platforms-title">Works alongside <em>every</em> interview platform.</h2>
        <p>It listens through your microphone, and tab audio on desktop, so it runs next to any video call or coding round. No plugin, no install.</p>
      </div>
      <div className="hp-rows hp-reveal">
        <Marquee seconds={34} label="Video call platforms">{PLATFORMS.map(item => <PlatformChip key={item.name} {...item} />)}</Marquee>
        <Marquee seconds={38} reverse label="Coding interview platforms">{CODING_PLATFORMS.map(item => <PlatformChip key={item.name} {...item} />)}</Marquee>
      </div>
      <ul className="landing-container hp-stats hp-reveal">
        <li><Timer size={18} aria-hidden="true" /><strong>~2 seconds</strong><span>for answers to start appearing</span></li>
        <li><Laptop size={18} aria-hidden="true" /><strong>0 installs</strong><span>runs in your browser</span></li>
        <li><Smartphone size={18} aria-hidden="true" /><strong>Laptop or phone</strong><span>built for both screens</span></li>
      </ul>
    </section>
  );
}

const MOMENTS: Array<{ icon: typeof Video; tag: string; title: string; body: string }> = [
  { icon: FileText, tag: "Behavioral", title: "“Tell me about yourself.”", body: "Your resume turns into a crisp, confident intro in your own words, not a script someone else wrote." },
  { icon: Brain, tag: "Technical", title: "Your mind goes blank on a definition", body: "Polymorphism, ACID, REST: a clear answer with a simple example is on screen as the question ends." },
  { icon: Code2, tag: "Live coding", title: "The round switches to code", body: "Clean, indented code appears first, with time and space complexity right under it." },
  { icon: Repeat2, tag: "Follow-ups", title: "“Why not a hash map instead?”", body: "It remembers the conversation, so follow-ups get answers that build on what you already said." },
  { icon: Boxes, tag: "Projects", title: "A deep-dive into your project", body: "Answers draw on the projects you uploaded, and never invent experience you do not have." },
  { icon: Layers, tag: "System design", title: "“Design a URL shortener.”", body: "Structured talking points: requirements, components and trade-offs, in the order you will say them." },
  { icon: Zap, tag: "Live", title: "The interviewer repeats the question", body: "Your answer stays steady on screen. No flicker, no regenerating, no wasted minutes." },
  { icon: Smartphone, tag: "Mobile", title: "Interviewing on your phone", body: "Answer on top, controls in one bar below, code that fits the screen. Readable at a glance." },
  { icon: Building2, tag: "Company rounds", title: "An Amazon loop next week", body: "Set the company and answers lean into what it screens for, like Leadership Principles." },
];

function MomentCard({ icon: Icon, tag, title, body }: (typeof MOMENTS)[number]) {
  return (
    <article className="hp-moment">
      <div className="hp-moment-top"><span className="hp-moment-icon"><Icon size={18} aria-hidden="true" /></span><span className="hp-moment-tag">{tag}</span></div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

/** Review-wall layout with real product moments (no invented reviews or ratings). */
export function HomeMoments() {
  const columns = [MOMENTS.slice(0, 3), MOMENTS.slice(3, 6), MOMENTS.slice(6, 9)];
  return (
    <section className="hp-section hp-moments" aria-labelledby="hp-moments-title">
      <div className="landing-container hp-head hp-head--dark hp-reveal">
        <p className="hp-kicker"><Sparkles size={14} aria-hidden="true" /> In the room with you</p>
        <h2 id="hp-moments-title">The moments it <em>saves you.</em></h2>
        <p>Every interview has a moment where it could slip. This is what you see on screen when it does.</p>
      </div>
      <div className="landing-container hp-wall">
        {columns.map((column, index) => (
          <div key={index} className={`hp-column ${index % 2 ? "hp-column--down" : ""}`} style={{ "--hp-duration": `${30 + index * 6}s` } as CSSProperties}>
            <div className="hp-column-track">
              <div className="hp-column-set">{column.map(moment => <MomentCard key={moment.title} {...moment} />)}</div>
              <div className="hp-column-set" aria-hidden="true">{column.map(moment => <MomentCard key={moment.title} {...moment} />)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="hp-wall-mobile"><Marquee seconds={48} label="Interview moments">{MOMENTS.map(moment => <MomentCard key={moment.title} {...moment} />)}</Marquee></div>
    </section>
  );
}

const TOPICS = ["DSA", "System design", "Low-level design", "OOP", "DBMS", "SQL", "Operating systems", "Computer networks", "React", "Node.js", "Python", "Java", "JavaScript", "Behavioral · STAR", "HR round", "Managerial round", "Product sense", "Project deep-dives"];

/** Company focus notes come from the same data the app uses to tailor answers. */
const COMPANY_BRANDS: Record<string, { slug?: string; color: string }> = {
  Amazon: { color: "#FF9900" }, Meta: { slug: "meta", color: "#0467DF" }, Google: { slug: "google", color: "#4285F4" }, Microsoft: { color: "#737373" },
  Apple: { slug: "apple", color: "#000000" }, Netflix: { slug: "netflix", color: "#E50914" }, Uber: { slug: "uber", color: "#000000" }, Airbnb: { slug: "airbnb", color: "#FF5A5F" },
  Flipkart: { color: "#2874F0" }, Swiggy: { slug: "swiggy", color: "#FC8019" }, Zomato: { slug: "zomato", color: "#E23744" }, PhonePe: { slug: "phonepe", color: "#5F259F" },
  Razorpay: { slug: "razorpay", color: "#0C2451" }, CRED: { color: "#1B1B1B" }, Zepto: { color: "#5B1D99" }, Nvidia: { slug: "nvidia", color: "#76B900" },
};

export function HomeCompanies() {
  const companies = COMPANIES.filter(company => company.name in COMPANY_BRANDS);
  return (
    <section className="hp-section hp-companies" aria-labelledby="hp-companies-title">
      <div className="landing-container hp-head hp-reveal">
        <p className="hp-kicker"><Building2 size={14} aria-hidden="true" /> Company-aware answers</p>
        <h2 id="hp-companies-title">Tuned for the company <em>you’re facing.</em></h2>
        <p>Pick your target company and role. Answers lean into what that company screens for, from product giants to fast-moving startups.</p>
      </div>
      <div className="hp-rows hp-reveal">
        <Marquee seconds={70} label="Companies with tailored interview focus">{companies.map(company => (
          <article key={company.name} className="hp-company"><BrandLogo name={company.name} {...COMPANY_BRANDS[company.name]} size={40} /><strong>{company.name}</strong><span>{company.focus.replace(/\s*\([^)]*\)/g, "").split(/[,;:]/)[0].trim()}</span></article>
        ))}</Marquee>
        <Marquee seconds={42} reverse label="Interview topics and rounds">{TOPICS.map(topic => <span key={topic} className="hp-topic">{topic}</span>)}</Marquee>
      </div>
      <p className="landing-container hp-footnote">Company names are shown to describe interview preparation only. InterviewWin is not affiliated with or endorsed by these companies.</p>
    </section>
  );
}
