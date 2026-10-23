# InterviewWin Live — integration contract v1

The application supports authorized live interviews and meetings only. Raw audio is ephemeral and never written to disk. All private data is tenant scoped.

## Decisions

Next.js 16.4 / React / TypeScript / Tailwind, FastAPI, SQLAlchemy async, PostgreSQL+pgvector (768 dimensions), Redis. SQLite and memory coordination are explicitly local development/test fallbacks. Gemini model defaults verified from official docs on 2026-10-14: gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.5-transcribe-live, gemini-embedding-001 (stable). API keys backend only. HTTP-only opaque sessions, same-origin mutation checks, one-use WebSocket ticket. Separate interviewer tab-audio and user's microphone channels when available. Mixed microphone cannot reliably attribute speakers; AI classification reports uncertainty.

## REST API (prefix /api)

Cookie credentials included. Mutations send X-InterviewPilot: 1; trusted Origin required in production. JSON errors: {detail:string}. UUID IDs are strings. Times are ISO UTC. Frontend rewrites /api/* to backend, WebSocket connects to NEXT_PUBLIC_WS_URL or same-origin /api/live/{id}/ws.

- GET /health -> {status, database, redis, ai_configured, billing_configured}
- POST /auth/register {email,password,name} -> user, sets cookie
- POST /auth/login {email,password} -> user, sets cookie
- POST /auth/logout -> {ok:true}
- GET /auth/me -> {id,email,name,plan,github_username,profile,minutes_used,minute_limit}
- PATCH /profile {name,github_username,preferences} -> user. preferences: {role,language,answer_style,answer_tone:professional|friendly|casual,english_level:simple|everyday|advanced,response_delivery:natural|talking_points|structured,personalization:grounded|technical,grounding:balanced|strict,reading_mode:auto|speech|paced|off,reading_wpm:60..240,job_description}. Live answers read saved answer preferences for each new question. Reader preferences apply to the client immediately after saving and do not change provider source facts.
- DELETE /auth/account -> {ok:true}, deletes owned records and uploaded files
- GET /projects -> Project[]; POST /projects {name,description} -> Project
- DELETE /projects/{id} -> {ok:true}
- POST /projects/{id}/github {url} -> Source (public repositories; token backend setting optional)
- GET /sources -> Source[]
- POST /sources/upload multipart file, optional project_id -> Source (202); workers ingest asynchronously
- POST /sources/{id}/retry -> Source; DELETE /sources/{id} -> {ok:true}
- GET /sources/{id}/download -> private file download
- GET /knowledge/search?q=... -> Evidence[]
- GET /sessions -> Session[]
- POST /sessions {consent:true, audio_mode:microphone|tab, title?, retention:true|false} -> Session
- GET /sessions/{id} -> Session plus turns
- POST /sessions/{id}/ticket -> {ticket,expires_in:60}
- POST /sessions/{id}/stop -> Session
- DELETE /sessions/{id} -> {ok:true}
- GET /provider/check -> {ok,models,detail}; verifies Google model availability, no secrets
- POST /billing/checkout -> {url}; POST /billing/portal -> {url}
- POST /billing/webhook -> signature verified, idempotent authoritative subscription sync

Project: {id,name,description,analysis:object,source_count:number,created_at}
Source: {id,project_id,name,kind,status:queued|processing|ready|failed,error:string|null,chunk_count:number,created_at}
Evidence: {id,source_id,project_id,source_name,text,score:number,locator:string,verified_contribution:boolean}
Session: {id,title,status:created|live|ended, audio_mode,retention,created_at,ended_at,summary:string,metrics:object}
Turn: {id,role:interviewer|user|unknown, text,question?:string,answer?:string,evidence?:Evidence[],created_at}

## WebSocket protocol

Ticket passed as ?ticket=...; consumed atomically and bound to owner, live session and the issuing authenticated HTTP session. Browser Origin must be trusted. The WebSocket does not need a second cookie; logout or expiry invalidates its authentication. No bearer API keys are exposed. Binary frames: first byte channel 0 (interviewer/tab) or 1 (user mic), remaining bytes 16kHz mono PCM16 little-endian. Microphone-only sends channel 0 (mixed). 100ms blocks, queue bounded. Client JSON: {type:ping} or {type:stop}; no manual question path.

Server JSON discriminated by type:
- status {state:connecting|listening|reconnecting|ended,detail?:string}
- transcript {id,role,text,final:boolean}
- question {generation_id,question,project_id?:string,keywords:string[]}
- answer_delta {generation_id,text}
- answer_complete {generation_id,answer,evidence:Evidence[],keywords:string[],latency_ms:number}
- answer_cancelled {generation_id}
- memory {summary:string,active_project_id?:string}
- metrics {first_token_ms?:number,total_ms?:number,questions:number,reconnects:number,audio_dropped:number}
- error {code,message,recoverable:boolean}
- pong

Only current generation is displayed. Browser captures permissions during Start's user gesture, then requires no further interaction. Permission revocation/browser background suspension is visible and terminates or reconnects as possible. Tab video track required by browser but no video frames leave the client.

The client reading guide aligns fresh user transcripts to the completed answer. Unknown mixed-microphone speech requires stronger matching; interviewer speech does not advance it. Auto mode falls back to estimated reading time during silence, with separate spoken and estimated cursors so confident speech can correct timing. It does not perform eye tracking. Underlining and automatic scrolling are confined to the answer pane and reset on answer generation changes.

Semantic question detection also produces a server-side response plan: code, explanation, debugging, design, behavioral, comparison, clarification or general. Code language and missing-detail flags remain internal; the existing answer stream delivers the selected format. Recent generated code is explicitly identified as AI output, bounded to 10,000 characters across two recent snippets, and supplied only for relevant follow-ups. Ambiguous tasks skip unnecessary retrieval. Unsuccessful provider finish reasons cancel the answer instead of marking partial code complete.

## Backend service interfaces

Backend service contract: Settings singleton from app.config.settings; async session factory app.db.SessionLocal; models app.models User, Project, Source, Chunk, LiveSession, Turn. ai.GeminiService exposes async embed(texts,task_type), structured(prompt,schema,fast=False), stream_answer(prompt), analyze_file(bytes,mime,prompt), check(). knowledge.ingest_source(source_id), retrieve(user_id,query,project_id=None,limit=6), build_profile(user_id). live.LiveOrchestrator(session_id,user_id,send) exposes run(audio_queue,stop_event); HTTP/WS lead invokes this. worker.run_worker() polls durable queued Source rows. More detailed model fields in app/models.py.
