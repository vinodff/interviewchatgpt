import { NextResponse } from "next/server";

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || (typeof Buffer !== "undefined" ? Buffer.from("QVEuQWI4Uk42S1NiZTYxcWpjVi1YbEFSZ2kzVWxQSUQzS2VSR1o4NG0tZnRQUzJBLVdrV3c=", "base64").toString("utf-8") : "");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, role, preferences = {}, evidence = [], customApiKey } = body;

    const apiKey = customApiKey || process.env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
    if (!apiKey || !question) {
      return NextResponse.json({ ok: false, answer: null });
    }

    const rawDelivery = preferences.response_delivery || "natural";
    const level = preferences.english_level || "everyday";
    const length = ["concise", "balanced", "detailed"].includes(preferences.answer_style) ? preferences.answer_style : "concise";
    const tone = preferences.answer_tone || "professional";
    const codeIntent = /(write|show|give|implement|create|generate|draft).{0,30}(code|function|method|program|script|implementation)|write.*python|python.*(code|function|program|script)|^(code|python code)/i.test(question);
    const delivery = codeIntent ? "code" : rawDelivery;

    const prompt = `You are a real-time interview assistant helping a candidate in an active technical interview.
Candidate Role: ${role || "Software Engineer"}
Answer Delivery Format: ${delivery} (options: natural conversational, talking_points bulleted, structured step-by-step, code fenced-implementation)
English Level: ${level} (options: simple, everyday, advanced)
Answer Length: ${length} (options: concise/short [under 50 words], balanced [~100 words], detailed)
Tone: ${tone} (options: casual, friendly, professional)
Candidate Evidence/Context: ${evidence.length ? evidence.map((e: any) => e.text).slice(0, 2).join("; ") : "None"}

QUESTION: "${question}"

CRITICAL INSTRUCTIONS:
1. Directly answer the specific technical or behavioral question accurately, in first-person voice the candidate can speak ("I use...", "In my work...").
2. CODE HAS TOP PRIORITY: if delivery is "code" or the question asks to write/show/implement Python code (e.g. linked list, dictionary, algorithms), output a complete runnable implementation FIRST in a fenced block tagged with the language (e.g. \`\`\`python), preserving indentation. Add at most one short plain sentence after the block. Never replace requested code with a paragraph explanation.
3. If delivery is "natural": deliver 2-3 flowing spoken sentences only. STRICTLY FORBIDDEN: bullet points (• - *), numbered lists (1. 2.), markdown headers (###), bold markers (**), or rigid section templates like "**Structure**:". No pointers. Speak naturally with contractions where appropriate, matching the candidate's own short spoken style.
4. If delivery is "talking_points": format as 3 clear bullet points with bold highlights.
5. If delivery is "structured": format as numbered steps.
6. If length is "concise" / short: keep it punchy, direct, and under 50 words so the candidate can say it effortlessly.
7. If English level is "simple": use straightforward, clear language that anyone can easily understand. Briefly explain necessary technical terms.
8. If Tone is "casual" or "friendly": sound warm, human, and conversational.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const models = ["gemini-3.8-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
    let generatedText = "";

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.35,
                maxOutputTokens: 2048
              }
            }),
            signal: controller.signal
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            generatedText = text.trim();
            break;
          }
        }
      } catch {
        /* try next model */
      }
    }

    clearTimeout(timeout);

    if (generatedText) {
      let finalText = generatedText;
      if (delivery === "natural") {
        // Enforce natural voice even if the model drifts into pointers.
        finalText = finalText
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/^\s*[•\-\*]\s+/gm, "")
          .replace(/^\s*\d+[.)]\s+/gm, "")
          .replace(/\*\*/g, "");
      }
      const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w: string) => w.length > 3);
      const uniqueWords = Array.from(new Set(qWords)).slice(0, 5);
      return NextResponse.json({ ok: true, answer: finalText, keywords: uniqueWords });
    }

    return NextResponse.json({ ok: false, answer: null });
  } catch {
    return NextResponse.json({ ok: false, answer: null });
  }
}
