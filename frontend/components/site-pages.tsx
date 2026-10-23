import Link from "next/link";
import { ArrowRight, ArrowUpRight, AudioLines, BookOpen, ChevronRight, CircleHelp, FileText, Folder, Mail, MessageSquare, Monitor, ShieldCheck, SlidersHorizontal, Smartphone } from "lucide-react";
import { ContactForm } from "./contact-form";
import { HelpCenter } from "./help-center";
import { SiteCta } from "./site-shell";
import { PricingSection } from "./pricing-section";
import { isBrowserWorkspace } from "@/lib/workspace-mode";
import { supportEmail, type SitePage } from "@/lib/site-content";

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="site-page-intro landing-container" data-reveal><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></section>;
}

const features = [
  { icon: BookOpen, title: "Your experience, connected", text: "Build a knowledge library from your resume, project notes, and source files. Give the conversation context that’s specific to you.", tag: "KNOWLEDGE LIBRARY" },
  { icon: AudioLines, title: "Help in the moment", text: "Receive streamed suggestions as questions emerge. Follow-ups can draw on earlier questions and the context of your current session.", tag: "LIVE ASSISTANCE" },
  { icon: SlidersHorizontal, title: "A style that sounds like you", text: "Choose natural phrasing, talking points, or structured answers. Adjust length, language level, and personalization.", tag: "ANSWER PREFERENCES" },
  { icon: FileText, title: "Keep the evidence close", text: "Review attached source excerpts when available. Distinguish information supported by your sources from general technical guidance.", tag: "SOURCE REFERENCES" },
  { icon: Smartphone, title: "Room to read, on any screen", text: "Adjust text size and reading preferences. On mobile, resize the answer pane and scroll it separately from the session controls.", tag: "READABLE BY DESIGN" },
  { icon: ShieldCheck, title: "Permission comes first", text: "Confirm participant consent before live capture. Control when capture starts and stops, and choose whether to retain session text.", tag: "VISIBLE CONTROLS" },
];

function FeaturesPage() {
  return <><PageIntro eyebrow="THE TOOLS. YOUR WAY." title="Less friction. More presence." description="Everything works toward one thing: making your own experience easier to reach when it matters." />
    <section className="landing-container feature-showcase" data-reveal><div><p className="eyebrow">CONTEXT MAKES THE DIFFERENCE</p><h2>From scattered notes<br />to a clearer answer.</h2><p>Your sources inform the suggestion. You bring the judgment, the story, and the voice.</p></div><div className="source-diagram" aria-label="Resume and project notes inform your talking points"><div><span><FileText size={18} /> Resume</span><span><Folder size={18} /> Project notes</span></div><ArrowRight size={26} aria-hidden="true" /><div className="source-output"><AudioLines size={26} /><strong>Your talking points</strong><small>Grounded in your context</small></div></div></section>
    <section className="landing-container feature-grid" aria-label="Interview features">{features.map(({ icon: Icon, title, text, tag }, index) => <article key={title} data-reveal data-reveal-delay={(index % 3) * 60}><div className="feature-icon"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /></div><p className="feature-tag">{tag}</p><h2>{title}</h2><p>{text}</p></article>)}</section>
    <div className="landing-container feature-footnote"><ShieldCheck size={18} /><p>AI suggestions can be inaccurate. Review the evidence and only make claims about experience you actually have.</p></div><SiteCta /></>;
}

const walkthrough = [
  { icon: FileText, title: "Give your account a foundation.", text: "Upload your resume, project notes, or source files to Resume & projects. Group related work into projects so relevant information is easier to find.", hint: "A good starting point: one resume and notes from a project you know well.", location: "Resume & projects" },
  { icon: SlidersHorizontal, title: "Make the context personal.", text: "Set your target role and describe the meeting or job. Choose your answer format, length, and reading preferences so suggestions fit how you communicate.", hint: "A specific role and a few lines of context are more useful than a long, generic prompt.", location: "My profile" },
  { icon: ShieldCheck, title: "Get permission. Then connect.", text: "Confirm that all participants and the organizer allow live AI assistance. In Live interview, select an available audio source, choose transcript retention, confirm consent, and start the session.", hint: "Your browser will request audio permission. Keep the tab visible during capture.", location: "Live interview" },
  { icon: MessageSquare, title: "Keep your focus on the conversation.", text: "Read suggestions as questions come in. Check source references, adapt the wording, and speak from your own understanding. Stop the session when the conversation ends.", hint: "If you keep session text, you can review it later in Past interviews.", location: "Your conversation" },
];

function HowItWorksPage() {
  return <><PageIntro eyebrow="A SIMPLE PLACE TO START" title="Bring your work. Find your words." description="A thoughtful setup makes the rest feel simpler. Here’s the path from your first source to a live conversation." />
    <section className="landing-container walkthrough" aria-label="Getting started steps">{walkthrough.map(({ icon: Icon, title, text, hint, location }, index) => <article key={title} data-reveal><div className="walkthrough-index"><span>0{index + 1}</span><Icon size={26} aria-hidden="true" /></div><div><p className="eyebrow">{location}</p><h2>{title}</h2><p>{text}</p><aside>{hint}</aside></div></article>)}</section>
    <section className="landing-container device-note" data-reveal><Monitor size={28} aria-hidden="true" /><div><h2>A quick note on your device.</h2><p>Desktop browsers may support shared-tab audio when your account offers it. Mobile browsers generally support the microphone only. Capture requires HTTPS or localhost, browser permission, and an active connection.</p></div><Link href="/help" className="landing-secondary">Device help <ArrowRight size={16} /></Link></section><SiteCta /></>;
}

function PlansPage() {
  return <><PageIntro eyebrow="FREE. STARTER. PRO." title="A plan for your next interview." description="Start with 30 free minutes. Choose a monthly plan when you need more interview time." /><PricingSection full />
    <section className="landing-container pricing-faq" aria-label="Pricing questions"><h2>A few clear answers.</h2><details><summary>What counts as a live minute?</summary><p>Time connected during a live interview counts toward your allowance. Uploading your resume, adjusting preferences, and reviewing saved interviews do not use live minutes.</p></details><details><summary>When do my minutes reset?</summary><p>Your allowance resets at the start of each calendar month. Unused minutes do not roll over. Paid subscriptions renew monthly from the subscription date.</p></details><details><summary>What happens when I use all my minutes?</summary><p>Live assistance stops at your limit. You can wait for the next monthly reset or choose an available paid plan. There are no automatic overage charges.</p></details><details><summary>Can I change or cancel a paid plan?</summary><p>Use Plans &amp; billing to open subscription management when paid plans are available. Review the terms shown there before confirming a change. <Link href="/contact">Contact support</Link> if you need help.</p></details></section><SiteCta /></>;
}

function AboutPage() {
  return <><PageIntro eyebrow="WHY INTERVIEWWIN EXISTS" title="Good work deserves clear words." description="You’ve already done the learning and the building. We want to make it easier to bring that experience into a conversation." />
    <section className="landing-container about-story" data-reveal><div className="about-quote"><AudioLines size={36} strokeWidth={1.2} aria-hidden="true" /><blockquote>“Your experience is the source of truth.”</blockquote><span>THE PRINCIPLE BEHIND THE PRODUCT</span></div><div><h2>A little support.<br />A lot more of you.</h2><p>Finding the right example in a stack of notes can pull you out of the moment. InterviewWin brings relevant source material and readable suggestions into one place.</p><p>The goal is to support your thinking and expression. Your judgment, your contribution, and the rules of the conversation stay at the center.</p><Link href="/how-it-works" className="landing-secondary">See the approach <ArrowRight size={16} /></Link></div></section>
    <section className="landing-container about-principles" aria-label="Our principles">{[{ title: "Evidence before embellishment", text: "A source can support a claim. It cannot turn someone else’s work into your own experience." }, { title: "Permission before capture", text: "Live assistance belongs in conversations where everyone has agreed to it and the organizer allows it." }, { title: "Clarity before complexity", text: "Readable answers, visible controls, and simple preferences should help you stay present." }].map((item, index) => <article key={item.title} data-reveal data-reveal-delay={index * 60}><span>0{index + 1}</span><h2>{item.title}</h2><p>{item.text}</p></article>)}</section><SiteCta /></>;
}

function HelpPage() {
  return <><PageIntro eyebrow="LET’S KEEP YOU MOVING" title="A little help, right here." description="Find a quick answer, work through setup, or get in touch when something doesn’t feel right." /><section className="landing-container help-section" aria-label="Help articles"><HelpCenter /></section></>;
}

function ContactPage({ selectedPlan }: { selectedPlan?: "starter" | "pro" }) {
  return <><PageIntro eyebrow="WE’RE LISTENING" title="Let’s find the next step." description="Need help, have a question, or see a way to make the interview screen better? We’d like to hear it." /><section className="landing-container contact-layout"><aside data-reveal><div className="contact-direct"><Mail size={25} aria-hidden="true" /><h2>A direct line.</h2><a href={`mailto:${supportEmail}`}>{supportEmail} <ArrowUpRight size={14} /></a><p>For product questions, account help, feedback, and privacy requests.</p></div><div className="contact-help"><CircleHelp size={23} aria-hidden="true" /><h2>Looking for a quick answer?</h2><p>Our help center covers setup, microphone access, source files, and saved data.</p><Link href="/help" className="landing-secondary">Visit the help center <ArrowRight size={16} /></Link></div></aside><div className="contact-form-panel" data-reveal data-reveal-delay="80"><h2>Tell us what’s on your mind.</h2><p>Share a few details so we can understand your question.</p><ContactForm selectedPlan={selectedPlan} /></div></section></>;
}

type PolicySection = { id: string; title: string; content: React.ReactNode };

function PrivacyPage() {
  const browser = isBrowserWorkspace();
  const sections: PolicySection[] = [
    { id: "information", title: "Information you provide", content: <p>InterviewWin processes the source files, project details, profile preferences, and conversation content you choose to use in the interview screen. Accounts also process sign-in details and usage information. If you email support, we receive the information in your message.</p> },
    { id: "storage", title: "Where your account lives", content: <p>{browser ? "This website uses the browser version. Readable source content, projects, preferences, and opted-in session text are saved in this browser on this device. They do not sync across devices. Clearing site data or losing access to the device can remove them. Keep copies of your original documents." : "This website is configured for an account. When the account service is connected, profile data, uploaded sources, projects, usage, and opted-in session text are stored by that service. Browser settings may also store local preferences. Your account shows the features available to your account."}</p> },
    { id: "processing", title: "How AI processing works", content: <><p>Uploaded content or relevant excerpts, profile context, questions, and session context may be sent to configured Google Gemini services for extraction, indexing, transcription, or answer generation. The selected speech mode may instead use your browser’s speech-recognition service. Saving a source on your device does not mean AI processing happens only on that device.</p><p>Provider retention and use depend on the provider, account, and service configuration. See <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Google’s Gemini API terms <ArrowUpRight size={13} /></a>. Do not upload information you are not permitted to share with those services.</p></> },
    { id: "audio", title: "Audio and session text", content: <p>Live capture requires your action, browser permissions, and confirmation of participant consent. The InterviewWin application processes audio live and does not save raw audio recordings. Transcription services still process the audio they receive under their own terms. Retaining session text is a separate choice. Stop ends capture; browser or device interruptions may also stop it.</p> },
    { id: "cookies", title: "Browser storage and service providers", content: <p>The interview assistant uses browser storage for saved preferences and, in browser mode, saved interview data. Accounts use session cookies for sign-in. Hosting and AI services process information needed to deliver the service and may keep operational records under their own policies. When account billing is enabled, Stripe handles checkout and subscription management. We do not ask you to enter payment-card details in our interview forms.</p> },
    { id: "choices", title: "Your choices and data requests", content: <p>Delete sources and retained sessions through the interview screen. Browser users can clear this site’s storage to remove saved data on this device. Account users can use the account deletion controls in My profile when available; manage any active subscription first. Deletion from the account does not by itself control third-party service records. Email <a href={`mailto:${supportEmail}?subject=Privacy%20request`}>{supportEmail}</a> with privacy or data requests. Do not include passwords, API keys, or private source documents in your initial email.</p> },
    { id: "updates", title: "Questions and updates", content: <p>This page describes the product’s current data flows. Review it when the service changes or before adding sensitive information. For questions about InterviewWin Live or this notice, contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p> },
  ];
  return <PolicyPage title="Privacy policy" description="A clear view of what you share, where it goes, and the choices you have." sections={sections} />;
}

function TermsPage() {
  const sections: PolicySection[] = [
    { id: "service", title: "Using InterviewWin", content: <p>InterviewWin Live provides AI-assisted suggestions based on the information and conversation context available to it. Use the interview screen only where AI assistance is permitted. If you do not agree with these conditions, do not use live assistance. Questions about the service can be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p> },
    { id: "permission", title: "Consent and responsible use", content: <p>Obtain agreement from all participants and follow the organizer’s interview or meeting rules before starting capture. Do not use InterviewWin to bypass assessment rules, secretly capture others, misrepresent your experience, impersonate another person, or access information without permission. Browser permissions do not replace participant consent.</p> },
    { id: "content", title: "Your sources and contributions", content: <p>Only add files, code, and personal information you are authorized to use and share for processing. You remain responsible for the accuracy of claims about your work. A repository or document reference does not prove authorship. Do not submit secrets, credentials, or material subject to restrictions that prevent this use.</p> },
    { id: "outputs", title: "AI suggestions and your judgment", content: <p>AI output may be incomplete, inaccurate, or unsupported. Review suggestions and source references before relying on them. InterviewWin does not guarantee a correct answer, uninterrupted capture, a successful interview, or any employment outcome. You decide how to use a suggestion.</p> },
    { id: "account", title: "Accounts, devices, and access", content: <p>Protect your sign-in credentials and the device holding your account. The browser version do not provide cross-device synchronization or a cloud backup. Audio availability depends on browser support, device permissions, network access, and service availability. Do not attempt to disrupt the service, bypass access controls, or access another user’s account.</p> },
    { id: "billing", title: "Plans and subscriptions", content: <p>Where subscriptions are enabled, review the price, allowance, billing interval, and terms in the checkout before subscribing. Manage an existing subscription through Plans & billing and its billing portal. Features and limits depend on your account. Preview versions do not offer subscriptions. Contact <a href={`mailto:${supportEmail}?subject=Billing%20question`}>{supportEmail}</a> about a billing issue.</p> },
    { id: "privacy", title: "Privacy and third-party services", content: <p>Read the <Link href="/privacy">privacy policy</Link> for information about sources, session text, audio processing, storage, and service providers. AI, browser speech, hosting, and payment services have their own terms. Do not use the service with information you are not allowed to send for processing.</p> },
    { id: "changes", title: "Service changes and contact", content: <p>The product and its features may change as the service develops. Review these terms when deciding whether to continue using the service. Nothing on this page is intended to remove rights that applicable law does not allow to be excluded. Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a> if you have a question about these conditions.</p> },
  ];
  return <PolicyPage title="Terms of use" description="The shared expectations that keep assistance useful, transparent, and responsible." sections={sections} />;
}

function PolicyPage({ title, description, sections }: { title: string; description: string; sections: PolicySection[] }) {
  return <><PageIntro eyebrow="THE ESSENTIALS, IN PLAIN LANGUAGE" title={title} description={description} /><div className="landing-container policy-layout"><aside><p className="eyebrow">ON THIS PAGE</p><nav aria-label={`${title} contents`}>{sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}<ChevronRight size={13} /></a>)}</nav><p className="policy-date">Updated October 21, 2026</p></aside><article>{sections.map((section, index) => <section key={section.id} id={section.id} data-reveal><span className="policy-index">{String(index + 1).padStart(2, "0")}</span><h2>{section.title}</h2>{section.content}</section>)}</article></div></>;
}

export function SitePageContent({ slug, selectedPlan }: { slug: SitePage; selectedPlan?: "starter" | "pro" }) {
  switch (slug) {
    case "features": return <FeaturesPage />;
    case "how-it-works": return <HowItWorksPage />;
    case "plans": return <PlansPage />;
    case "about": return <AboutPage />;
    case "help": return <HelpPage />;
    case "contact": return <ContactPage selectedPlan={selectedPlan} />;
    case "privacy": return <PrivacyPage />;
    case "terms": return <TermsPage />;
  }
}
