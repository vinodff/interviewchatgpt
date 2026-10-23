export const supportEmail = "vcontenthelper@gmail.com";

export const sitePages = {
  features: { title: "Features", description: "Explore source-grounded answers, readable talking points, and an interview assistant built around your experience." },
  "how-it-works": { title: "How it works", description: "From your first source to a consent-based live conversation: get started with InterviewWin." },
  plans: { title: "Pricing", description: "Compare Free, Starter, and Pro plans for live interview assistance, with clear monthly prices and minute limits." },
  about: { title: "About", description: "Why we’re building a calmer, more thoughtful way to bring your experience into a conversation." },
  help: { title: "Help center", description: "Find answers about getting started, microphone permissions, sources, and your data." },
  contact: { title: "Contact", description: "Get help with InterviewWin or share feedback with the team." },
  privacy: { title: "Privacy policy", description: "Understand how InterviewWin handles your sources, audio, session text, and account information." },
  terms: { title: "Terms of use", description: "Read the conditions for responsible use of InterviewWin Live." },
} as const;

export type SitePage = keyof typeof sitePages;
export function isSitePage(slug: string): slug is SitePage { return Object.hasOwn(sitePages, slug); }

export const helpItems = [
  { id: "getting-started", category: "Getting started", question: "How do I start my first interview?", answer: "Select Start live interview and sign in. Add your resume in Resume & projects if you want personalized answers. On the Live interview screen, choose your audio source, confirm everyone agrees to AI assistance, and select Start live interview. Your microphone stays off until you start and allow browser access." },
  { id: "sources", category: "Getting started", question: "What resume or project files can I add?", answer: "Start with your resume and notes about projects you have worked on. Text-based PDFs, text files, Markdown, and supported source files are good starting points. The upload screen lists the formats available in your version. Only add files you have permission to share for AI processing." },
  { id: "microphone", category: "Audio & devices", question: "Why can’t the website hear me?", answer: "Allow microphone access in your browser’s site settings and check your selected input device. Use HTTPS or localhost. Check that your device microphone is not muted or occupied by another app. Stop the session, refresh if needed, and try again. Never send your password or API key when asking for help." },
  { id: "mobile", category: "Audio & devices", question: "Can I use it on my phone?", answer: "Yes. Use a compatible mobile browser and keep the page in the foreground during capture. The answer pane and controls scroll independently. Mobile browsers generally cannot capture audio directly from another app. Headphones, screen locks, calls, or browser suspension can interrupt what the microphone hears." },
  { id: "meeting-audio", category: "Audio & devices", question: "Can I capture a meeting tab?", answer: "When shared-tab audio is available, desktop Chrome or Edge may let you select a browser tab and enable Share audio. This depends on your account and browser. A microphone can only capture audible room sound; it does not grant access to another app’s audio." },
  { id: "answer-style", category: "Getting started", question: "How do I change the answers and reading style?", answer: "Open My profile or Answer options. Choose your answer format, language level, length, text size, and reading preferences. Saved answer preferences apply to the next question. Reading guide preferences can apply immediately without restarting capture." },
  { id: "consent", category: "Privacy & access", question: "Do I need permission from the other participants?", answer: "Yes. Everyone must agree to live AI assistance, and the organizer’s interview or meeting rules must allow it. Confirm permission before you start. InterviewWin does not bypass browser capture indicators or other people’s rules." },
  { id: "storage", category: "Privacy & access", question: "Where are my files and conversations saved?", answer: "The browser version saves files, preferences, and interview text on your device. Clearing site data removes them; they do not sync across devices. Account-based access stores your saved data with the service. The app does not save audio recordings. Relevant content is sent to AI services for processing. See the Privacy policy for details." },
  { id: "delete", category: "Privacy & access", question: "How do I remove my data?", answer: "Remove sources and retained sessions from Resume & projects and Past interviews. Browser users can also clear this site’s storage, which permanently removes saved data on this device. In an account, account deletion is available in My profile. Manage any active subscription before deleting your account. Contact support for questions about data requests." },
  { id: "billing", category: "Privacy & access", question: "Where can I see plan limits or manage billing?", answer: "Accounts show current allowances in Plans & billing. If subscriptions are available, the checkout shows the price and terms before you subscribe. The billing portal manages an existing subscription. Preview versions do not offer subscriptions. AI service quotas may still apply." },
] as const;
