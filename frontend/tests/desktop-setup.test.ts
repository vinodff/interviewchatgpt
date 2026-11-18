import { describe, expect, it } from "vitest";
import { DEFAULT_SETUP, desktopMessage, knowledgeSourcesOf, readSetup, sessionTitle, setupPreferences, withAvailableSources } from "@/lib/desktop-setup";
import type { Source } from "@/lib/types";

const source = (id: string, status: Source["status"] = "ready", name = `${id}.pdf`): Source => ({ id, project_id: null, name, kind: "pdf", status, error: null, chunk_count: 3, created_at: "2026-01-01T00:00:00Z" });

describe("readSetup", () => {
  it("falls back to defaults for missing or corrupt storage", () => {
    expect(readSetup(null)).toEqual(DEFAULT_SETUP);
    expect(readSetup("{not json")).toEqual(DEFAULT_SETUP);
    expect(readSetup("[1,2]")).toEqual(DEFAULT_SETUP);
  });

  it("fills empty fields from the saved profile preferences", () => {
    const setup = readSetup(null, { company: "Google", role: "SDE II", language: "Hindi", answer_model: "smart", session_type: "meeting" });
    expect(setup).toMatchObject({ company: "Google", role: "SDE II", language: "Hindi", model: "smart", sessionType: "meeting" });
  });

  it("rejects unknown values, control characters and oversized text", () => {
    const setup = readSetup(JSON.stringify({ sessionType: "party", model: "gpt-x", language: "Klingon", company: "Acme\u0000Corp", customInstructions: "x".repeat(5000), resumeId: "../etc", docIds: ["a", "a", 5, "b"], humanize: "yes" }));
    expect(setup.sessionType).toBe("interview");
    expect(setup.model).toBe("fast");
    expect(setup.language).toBe("English");
    expect(setup.company).toBe("Acme Corp");
    expect(setup.customInstructions).toHaveLength(2000);
    expect(setup.resumeId).toBeNull();
    expect(setup.docIds).toEqual(["a", "b"]);
    expect(setup.humanize).toBe(true);
    expect(setup.shortcuts).toBe(true);
    expect(readSetup(JSON.stringify({ shortcuts: false })).shortcuts).toBe(false);
    expect(readSetup(JSON.stringify({ shortcuts: "off" })).shortcuts).toBe(true);
  });
});

describe("source selection", () => {
  it("drops deleted or unfinished sources and keeps the resume out of reference docs", () => {
    const setup = { ...DEFAULT_SETUP, resumeId: "r1", docIds: ["d1", "gone", "r1", "busy"] };
    expect(withAvailableSources(setup, [source("r1"), source("d1"), source("busy", "processing")])).toMatchObject({ resumeId: "r1", docIds: ["d1"] });
  });

  it("returns no knowledge sources when continuing without a resume or docs", () => {
    expect(knowledgeSourcesOf(DEFAULT_SETUP)).toEqual([]);
    expect(knowledgeSourcesOf({ ...DEFAULT_SETUP, resumeId: "r1", docIds: ["d1"] })).toEqual(["r1", "d1"]);
  });
});

describe("setupPreferences", () => {
  it("layers session settings over the profile and keeps answers technical without knowledge", () => {
    const preferences = setupPreferences({ ...DEFAULT_SETUP, company: "Meta", model: "smart", customInstructions: "Use bullet points" }, { answer_style: "balanced", personalization: "grounded" });
    expect(preferences).toMatchObject({ answer_style: "balanced", company: "Meta", answer_model: "smart", humanize: true, custom_instructions: "Use bullet points", session_type: "interview", personalization: "technical" });
  });

  it("keeps the profile's personalization when a resume is selected", () => {
    expect(setupPreferences({ ...DEFAULT_SETUP, resumeId: "r1" }, { personalization: "grounded" }).personalization).toBe("grounded");
  });
});

describe("desktopMessage", () => {
  it("replaces web-only microphone advice with steps that work in the desktop app", () => {
    expect(desktopMessage("Streaming recognition is unavailable. Select Enhanced microphone and restart.")).toBe("Streaming recognition is unavailable. Check your internet connection, then start the session again.");
    expect(desktopMessage("Streaming recognition was interrupted. Please restart and repeat the last question, or select Enhanced microphone.")).toBe("Streaming recognition was interrupted. Please restart and repeat the last question.");
    expect(desktopMessage("Your microphone was disconnected.")).toBe("Your microphone was disconnected.");
  });
});

describe("sessionTitle", () => {
  it("names the session by type, company and role", () => {
    expect(sessionTitle({ ...DEFAULT_SETUP, company: "Google", role: "SWE" })).toBe("Interview · Google · SWE");
    expect(sessionTitle({ ...DEFAULT_SETUP, sessionType: "meeting" })).toBe("Meeting (desktop)");
  });
});
