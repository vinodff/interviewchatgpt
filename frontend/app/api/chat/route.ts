import { NextRequest } from "next/server";

// ─── Knowledge base ────────────────────────────────────────────────────────
const KNOWLEDGE = `
# InterviewWin Live — Complete Website Knowledge Base

## What is InterviewWin Live?
InterviewWin Live is a real-time AI interview assistant that listens during live interviews and meetings, then provides grounded talking points and answers based on your resume and project experience. It is built for job seekers who want clearer, more confident interviews.

## Core Features
- Real-time AI suggestions while the interviewer speaks
- Microphone capture on mobile and desktop; tab audio capture on desktop Chrome/Edge
- Answers grounded in your uploaded resume and project notes
- Knowledge base for job descriptions and company notes
- Think mode for harder technical and system-design questions
- Role presets: Software Engineering (SWE), System Design, Product Management (PM), Behavioral
- STAR-structured behavioral answers
- Interview minutes never expire
- Works on mobile and desktop browsers

## How It Works (3 Steps)
1. Bring your experience — Upload your resume and project notes so the AI has real context.
2. Make it feel like you — Choose your target role, answer style, and reading preferences.
3. Start the conversation — Confirm everyone agrees to AI assistance, select your microphone, and start live assistance.

## Pricing & Plans (INR, one-time packs, no subscription)
- **Free**: 2 minutes — ₹0, completely free, no card needed
- **Starter**: 20 minutes — ₹199 one-time (₹9.95/min)
- **Popular (Most popular)**: 45 minutes — ₹399 one-time (₹8.87/min, ~11% cheaper per min vs Starter)
- **Value**: 120 minutes — ₹999 one-time (₹8.33/min, ~16% cheaper per min vs Starter)
All paid plans include every feature. Minutes never expire. No monthly fees.

## Payment Gateway
InterviewWin uses **Cashfree Payments** as its payment gateway. Cashfree is a leading Indian payment gateway that supports UPI, credit/debit cards, net banking, and wallets. All transactions are in INR. After checkout, minute credits are added to your account instantly.

## Who Should Use It?
- Software engineers preparing for coding and system design interviews
- Product managers preparing for PM interviews
- Anyone doing behavioral or HR interviews
- Job seekers who get nervous during live conversations and want structured guidance

## Privacy & Data
- Audio is never saved. It is processed live and discarded.
- Resume and project files are stored securely and only used to generate your answers.
- You can delete all your data from your account at any time.
- Session transcripts are retained only if you choose to keep them.
- InterviewWin does not bypass browser capture indicators or recording consent.

## Consent & Ethics
Everyone in the interview or meeting must agree to AI assistance. The organizer's rules must allow it. You confirm consent before capture starts. InterviewWin does not support unauthorized recording.

## Mobile Support
Yes, InterviewWin works on mobile. Use Chrome or Safari on Android/iOS. Keep the browser in the foreground during capture. Mobile browsers cannot capture another app's audio. The interface adapts to small screens.

## Desktop Browser Support
Best experience on Chrome and Edge. Tab audio capture (to hear the interviewer through the computer) requires desktop Chrome or Edge with "Share audio" enabled when sharing a tab.

## Microphone Troubleshooting
1. Allow microphone permission in your browser's site settings.
2. Make sure your device microphone is not muted or used by another app.
3. Restart the session and refresh the page if issues persist.
4. Use HTTPS or localhost.

## Getting Started (Free)
1. Go to interviewwin.live
2. Click "Start live interview"
3. Sign in (or use as guest for 2 free minutes)
4. Add your resume in "Resume & projects" (optional but recommended)
5. Choose your role and preferences
6. Confirm everyone agrees, pick your microphone, and click Start

## Contact & Support
- Email: vcontenthelper@gmail.com
- Phone: +91 80192 38515
- Business hours: Monday – Saturday, 9:00 AM – 6:00 PM IST
- Address: 1-264, Laku Peta, Sakhinetipalli, East Godavari, Andhra Pradesh, PIN 533251, India

## Refund Policy
- Refunds are processed in 5 to 7 working days.
- Contact support with your order details to request a refund.
- Unused minutes may be eligible for refund within the policy window.

## Shipping & Delivery
InterviewWin is a digital SaaS product. Minute credits are delivered instantly to your account after successful payment. There is no physical shipping.

## About InterviewWin
InterviewWin was built to help people bring their actual experience into live conversations — without freezing up or forgetting key details. The goal is a calmer, more thoughtful way to present yourself.

## Pages & Links
- Home: interviewwin.live/
- Features: interviewwin.live/features
- How it works: interviewwin.live/how-it-works
- Pricing: interviewwin.live/plans
- About: interviewwin.live/about
- Help center: interviewwin.live/help
- Contact: interviewwin.live/contact
- Privacy Policy: interviewwin.live/privacy
- Terms & Conditions: interviewwin.live/terms
- Refunds: interviewwin.live/refund-policy
- Shipping: interviewwin.live/shipping-policy
- Start interview: interviewwin.live/interview
`;

const SYSTEM_PROMPT = `You are the helpful support assistant for InterviewWin Live, a real-time AI interview assistant. 
Answer questions about the product, pricing, payment, features, privacy, and getting started using ONLY the knowledge base below.
Be friendly, concise, and clear. Use bullet points for lists. Use ₹ for prices.
If someone asks something not covered in the knowledge base, politely say you don't have that info and suggest they contact support at vcontenthelper@gmail.com or call +91 80192 38515.
Never make up information. Never discuss topics unrelated to InterviewWin.
Keep answers short (2-5 sentences or a short bullet list unless more detail is clearly needed).
Always reply in the same language as the user's question.

KNOWLEDGE BASE:
${KNOWLEDGE}`;

// ─── Types ─────────────────────────────────────────────────────────────────
interface ChatMessage { role: "user" | "model"; parts: { text: string }[] }

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json() as { messages: ChatMessage[] };
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI service not configured." }), { status: 503, headers: { "Content-Type": "application/json" } });
    }

    // Build Gemini request — streaming NDJSON
    const geminiBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.slice(-12), // last 12 turns max
      generationConfig: { maxOutputTokens: 512, temperature: 0.4, topP: 0.9 },
    };

    const model = "gemini-2.0-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!upstream.ok) {
      const err = await upstream.text().catch(() => "");
      console.error("[chat] Gemini error:", upstream.status, err.slice(0, 300));
      return new Response(JSON.stringify({ error: "AI service error. Please try again." }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    // Stream SSE → plain text chunks to client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (!json || json === "[DONE]") continue;
              try {
                const parsed = JSON.parse(json);
                const text: string = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (text) controller.enqueue(encoder.encode(text));
              } catch { /* skip malformed */ }
            }
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[chat] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
