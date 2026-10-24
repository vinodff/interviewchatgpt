import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, AudioLines, ChevronRight, Code2, FileText, Folder, ShieldCheck, SlidersHorizontal, Smartphone } from "lucide-react";
import { HomeDemo } from "@/components/home-demo";
import { HomeHero3D } from "@/components/home-hero-3d";
import { HomeShowcase, MobileShowcase } from "@/components/home-showcase";
import { ShowcaseMotion } from "@/components/showcase-motion";
import { ScrollMotion } from "@/components/scroll-motion";
import { isBrowserWorkspace } from "@/lib/workspace-mode";
import { PricingSection } from "@/components/pricing-section";
import { legacyInterviewUrl } from "@/lib/interview-navigation";
import "./home.css";

const steps = [
  { icon: FileText, title: "Bring your experience.", text: "Add your resume and project notes so suggestions have something real to draw from." },
  { icon: SlidersHorizontal, title: "Make it feel like you.", text: "Choose your target role, answer style, and the way you like to read." },
  { icon: AudioLines, title: "Start the conversation.", text: "Confirm everyone’s permission, select your microphone, and start live assistance." },
];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (typeof query.reset === "string" && query.reset || typeof query.billing === "string") redirect(legacyInterviewUrl(query));
  const browser = isBrowserWorkspace();
  return <ScrollMotion><ShowcaseMotion><div className="home-page">
    <section className="home-hero landing-container" data-scroll-scene>
      <div className="home-hero-heading" data-reveal><p className="home-kicker"><span className="home-dot" /> YOUR NEXT INTERVIEW. A CLEARER HEAD.</p><h1>You know your story.<br /><em>Find the words, live.</em></h1><p className="home-intro">Your experience, turned into clear talking points.<br className="home-desktop-break" /> Live interview assistance that keeps your knowledge within reach.</p><div className="landing-actions"><Link href="/interview?view=live" className="button button-primary">Start live interview <ArrowRight size={18} /></Link><a href="#product-preview" className="home-demo-link">Explore the live preview <ChevronRight size={17} /></a></div><p className="home-hero-note">30 free minutes per month <span>·</span> No card needed <span>·</span> Use with everyone’s permission</p></div>
      <MobileShowcase />
      <div className="home-product-scroll" data-scroll-layer="hero"><HomeHero3D><div className="home-product-stage" data-reveal data-reveal-delay="100"><div className="home-stage-label"><span>YOUR EXPERIENCE → YOUR ANSWERS</span><span>Try a question below <ArrowRight size={14} /></span></div><HomeDemo /></div></HomeHero3D></div>
      <div className="home-capabilities"><span><AudioLines size={18} /> Live suggestions</span><span><Folder size={18} /> Resume & project context</span><span><Code2 size={18} /> Technical & behavioral</span><span><Smartphone size={18} /> Desktop to mobile</span></div>
    </section>
    <HomeShowcase />
    <section className="home-process" id="how-it-works"><div className="landing-container"><div className="home-process-heading" data-reveal><div><p className="home-kicker">A SIMPLE START</p><h2>Your next conversation,<br /><em>three steps away.</em></h2></div><Link href="/how-it-works" className="home-light-link">See the full walkthrough <ArrowRight size={17} /></Link></div><div className="home-steps">{steps.map(({ icon: Icon, title, text }, index) => <article key={title} data-reveal data-reveal-delay={index * 70}><div><Icon size={24} strokeWidth={1.6} /><span>0{index + 1}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div><div className="home-consent"><ShieldCheck size={21} /><p><strong>You stay in control.</strong> Start and stop capture yourself. Use assistance only where everyone has agreed and the organizer’s rules allow it.</p></div></div></section>
    <PricingSection />
    <section id="questions" className="landing-section landing-container landing-faq"><div className="landing-section-heading"><p className="home-kicker">GOOD QUESTIONS.</p><h2>A few things<br /><em>before you begin.</em></h2><p>More answers in our <Link href="/help">help center <ArrowRight size={14} /></Link></p></div><div>
      <details><summary>When can I use live assistance?</summary><p>Use it only in interviews and meetings where all participants have agreed to AI assistance and the organizer’s rules allow it. You confirm consent before capture starts.</p></details>
      <details><summary>Where is my information stored?</summary><p>{browser ? "This version saves projects, readable source files, preferences, and opted-in session text in this browser on this device. It does not sync across devices. Clearing browser data removes it, so keep your original files." : "Your account stores uploaded sources and preferences. Session text is retained only when you choose to keep it. The app does not save raw audio recordings. Audio is processed live by the configured service."}</p></details>
      <details><summary>Can I use it on my phone?</summary><p>Yes. The interview screen adapts to smaller screens and supports microphone capture in compatible browsers. Live capture requires microphone permission and HTTPS. Mobile browsers generally cannot capture another app’s audio, and backgrounding the browser can interrupt capture.</p></details>
      <details><summary>Will every answer be accurate?</summary><p>AI can make mistakes. Review suggestions and source references, use your own judgment, and only make claims about experience you actually have.</p></details>
    </div></section>
    <section className="home-final"><div className="landing-container" data-reveal><span className="home-final-icon"><AudioLines size={30} /></span><p className="home-kicker">BRING YOUR EXPERIENCE. FIND YOUR FLOW.</p><h2>Your story deserves<br /><em>a clear delivery.</em></h2><p>Take your first step toward a more focused conversation.</p><Link href="/interview?view=live" className="button button-primary">Start live interview <ArrowRight size={18} /></Link><small>Start with 30 free minutes per month.</small></div></section>
  </div></ShowcaseMotion></ScrollMotion>;
}


