import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, role, preferences = {}, evidence = [], customApiKey } = body;

    const apiKey = customApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || !question) {
      return NextResponse.json({ ok: false, answer: null });
    }

    const delivery = preferences.response_delivery || "natural";
    const level = preferences.english_level || "everyday";
    const length = preferences.answer_style || "concise";
    const tone = preferences.answer_tone || "professional";

    const prompt = `You are a real-time interview assistant helping a candidate in an active technical interview.
Candidate Role: ${role || "Software Engineer"}
Answer Delivery Format: ${delivery} (options: natural conversational, talking_points bulleted, structured step-by-step)
English Level: ${level} (options: simple, everyday, advanced)
Answer Length: ${length} (options: concise/short [under 50 words], balanced [~100 words], detailed)
Tone: ${tone} (options: casual, friendly, professional)
Candidate Evidence/Context: ${evidence.length ? evidence.map((e: any) => e.text).slice(0, 2).join("; ") : "None"}

QUESTION: "${question}"

CRITICAL INSTRUCTIONS:
1. Directly answer the specific technical or behavioral question accurately.
2. If delivery is "natural": deliver the answer as natural spoken speech that sounds authentic when spoken by a human candidate. Do NOT use markdown headers (###) or rigid section templates.
3. If delivery is "talking_points": format as 3 clear bullet points with bold highlights.
4. If length is "concise" / short: keep it punchy, direct, and under 50 words so the candidate can say it effortlessly.
5. If English level is "simple": use straightforward, clear language that anyone can easily understand.
6. If Tone is "casual" or "friendly": sound warm, human, and conversational.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const models = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
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
                temperature: 0.4,
                maxOutputTokens: length === "concise" ? 180 : length === "detailed" ? 500 : 300
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
      const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w: string) => w.length > 3).slice(0, 5);
      return NextResponse.json({ ok: true, answer: generatedText, keywords: qWords });
    }

    return NextResponse.json({ ok: false, answer: null });
  } catch {
    return NextResponse.json({ ok: false, answer: null });
  }
}
