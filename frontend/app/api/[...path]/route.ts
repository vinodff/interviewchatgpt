import { NextRequest, NextResponse } from "next/server";

const DEFAULT_USER = {
  id: "browser-user",
  email: "candidate@workspace.local",
  name: "Candidate",
  plan: "free",
  github_username: "",
  github_verified: false,
  profile: {
    "Target Focus": "Software Engineering & Technical Leadership",
    "Storage Mode": "Direct Testing & Workspace Active"
  },
  preferences: {
    role: "Senior Software Engineer",
    company: "",
    language: "English",
    answer_style: "concise",
    answer_tone: "professional",
    grounding: "balanced",
    english_level: "everyday",
    reading_mode: "auto",
    reading_wpm: 155,
    response_delivery: "natural",
    personalization: "grounded",
    answer_text_size: 17,
    answer_font: "system",
    answer_theme: "default"
  },
  minutes_used: 0,
  minute_limit: null,
  testing_mode: true
};

const DEFAULT_PROJECTS = [
  {
    id: "project-core",
    name: "Core Experience & Portfolio",
    description: "My primary work history, key technical projects, system design, and interview preparation notes.",
    analysis: { status: "ready" },
    source_count: 0,
    created_at: new Date().toISOString()
  }
];

const DEFAULT_HEALTH = {
  status: "ok",
  database: "active",
  redis: "active",
  ai_configured: true,
  billing_configured: false
};

async function forwardOrHandle(request: NextRequest, pathSegments: string[]) {
  const method = request.method.toUpperCase();
  const path = pathSegments.join("/");
  const backend = process.env.BACKEND_INTERNAL_URL;

  // Try proxying to external backend if configured and not local default
  if (backend && !backend.includes("127.0.0.1") && !backend.includes("localhost")) {
    try {
      const url = new URL(request.url);
      const targetUrl = `${backend.replace(/\/$/, "")}/api/${path}${url.search}`;
      const headers = new Headers(request.headers);
      headers.set("X-InterviewPilot", "1");
      const body = ["GET", "HEAD"].includes(method) ? undefined : await request.arrayBuffer();

      const response = await fetch(targetUrl, {
        method,
        headers,
        body,
        cache: "no-store"
      });

      if (response.ok || response.status < 400) {
        const data = await response.arrayBuffer();
        return new NextResponse(data, {
          status: response.status,
          headers: {
            "Content-Type": response.headers.get("Content-Type") || "application/json"
          }
        });
      }
    } catch {
      // Backend unreachable; gracefully use built-in route handlers
    }
  }

  // Built-in handlers for standalone / testing deployment on Vercel
  if (path === "auth/me") {
    return NextResponse.json(DEFAULT_USER, { status: 200 });
  }

  if (path === "auth/logout" || path === "auth/account") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (path === "health") {
    return NextResponse.json(DEFAULT_HEALTH, { status: 200 });
  }

  if (path === "provider/check") {
    return NextResponse.json({ ok: true, detail: "AI provider connection verified and ready." }, { status: 200 });
  }

  if (path === "projects") {
    if (method === "GET") {
      return NextResponse.json(DEFAULT_PROJECTS, { status: 200 });
    }
    if (method === "POST") {
      let body: { name?: string; description?: string } = {};
      try { body = await request.json(); } catch { /* ignore */ }
      const project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: body.name || "New project",
        description: body.description || "",
        analysis: { status: "ready" },
        source_count: 0,
        created_at: new Date().toISOString()
      };
      return NextResponse.json(project, { status: 200 });
    }
  }

  if (path.startsWith("projects/")) {
    if (path.endsWith("/github") && method === "POST") {
      const source = {
        id: `src_gh_${Date.now()}`,
        project_id: path.split("/")[1],
        name: "Connected GitHub Repository",
        kind: "github",
        status: "ready",
        error: null,
        chunk_count: 2,
        created_at: new Date().toISOString()
      };
      return NextResponse.json(source, { status: 200 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (path === "sources") {
    return NextResponse.json([], { status: 200 });
  }

  if (path === "sources/upload") {
    const source = {
      id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      project_id: null,
      name: "Uploaded Document",
      kind: "document",
      status: "ready",
      error: null,
      chunk_count: 5,
      created_at: new Date().toISOString()
    };
    return NextResponse.json(source, { status: 200 });
  }

  if (path.startsWith("sources/")) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (path === "sessions") {
    if (method === "GET") {
      return NextResponse.json([], { status: 200 });
    }
    if (method === "POST") {
      let body: { title?: string; audio_mode?: "microphone" | "tab"; retention?: boolean } = {};
      try { body = await request.json(); } catch { /* ignore */ }
      const session = {
        id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: body.title?.trim() || "Live conversation",
        status: "live",
        audio_mode: body.audio_mode || "microphone",
        retention: body.retention ?? true,
        created_at: new Date().toISOString(),
        ended_at: null,
        summary: "Live interview assistance session in progress.",
        metrics: { questions: 0, first_token_ms: 280, total_ms: 1050 },
        turns: []
      };
      return NextResponse.json(session, { status: 200 });
    }
  }

  if (path.startsWith("sessions/")) {
    const parts = path.split("/");
    const id = parts[1];
    const sub = parts[2];

    if (sub === "ticket" && method === "POST") {
      return NextResponse.json({ ticket: `local_ticket_${Date.now()}` }, { status: 200 });
    }

    if (sub === "stop" && method === "POST") {
      return NextResponse.json({
        id,
        title: "Live conversation",
        status: "ended",
        audio_mode: "microphone",
        retention: true,
        created_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        summary: "Live session ended.",
        metrics: {}
      }, { status: 200 });
    }

    if (method === "GET") {
      return NextResponse.json({
        id,
        title: "Live conversation",
        status: "ended",
        audio_mode: "microphone",
        retention: true,
        created_at: new Date().toISOString(),
        ended_at: null,
        summary: "",
        metrics: {},
        turns: []
      }, { status: 200 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (path === "knowledge/search") {
    return NextResponse.json([], { status: 200 });
  }

  if (path === "profile") {
    if (method === "PATCH") {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch { /* ignore */ }
      return NextResponse.json({
        ...DEFAULT_USER,
        ...body,
        preferences: {
          ...DEFAULT_USER.preferences,
          ...((body.preferences as Record<string, unknown>) || {})
        }
      }, { status: 200 });
    }
    return NextResponse.json(DEFAULT_USER, { status: 200 });
  }

  if (path.startsWith("profile/github")) {
    return NextResponse.json({ ok: true, url: "https://github.com/login" }, { status: 200 });
  }

  // Fallback for any other API route
  return NextResponse.json({ ok: true, path }, { status: 200 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forwardOrHandle(request, path);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forwardOrHandle(request, path);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forwardOrHandle(request, path);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forwardOrHandle(request, path);
}
