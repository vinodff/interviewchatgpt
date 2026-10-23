import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addStoredGithubSource, addTurnToStoredSession, createStoredSession, deleteStoredProject, deleteStoredSource, getStoredSession, getStoredSources, getStoredSourceContent, searchStoredEvidence, uploadStoredSource, updateStoredUser, getStoredUser } from "../lib/browser-storage";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe("truthful browser knowledge and persistence", () => {
  it("returns no evidence when no supporting sources exist", () => {
    expect(searchStoredEvidence("Tell me about my projects")).toEqual([]);
  });
  it("keeps uploaded text as reported evidence, without inventing verification", async () => {
    const source = await uploadStoredSource(new File(["Built a Python payments service with idempotent requests."], "project.txt"), null);
    const evidence = searchStoredEvidence("Python payments");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].verified_contribution).toBe(false);
    expect(evidence[0].text).toContain("idempotent");
    deleteStoredSource(source.id);
    expect(getStoredSourceContent(source.id)).toBeNull();
  });
  it("does not retrieve unrelated sources as high confidence evidence", async () => {
    await uploadStoredSource(new File(["Built a Python payments service with idempotent requests."], "project.txt"), null);
    expect(searchStoredEvidence("Explain photosynthesis")).toEqual([]);
  });
  it("does not count partial words or question boilerplate as evidence for a technical definition", async () => {
    await uploadStoredSource(new File(["Alex built a database management service for accounting. Describe the engineering experience in this document."], "resume.txt"), null);
    expect(searchStoredEvidence("What is DBMS?")).toEqual([]);
    expect(searchStoredEvidence("Explain an abstract class.")).toEqual([]);
    expect(searchStoredEvidence("count")).toEqual([]); // Not the substring in "accounting".
    expect(searchStoredEvidence("database management")).toHaveLength(1);
  });
  it("rejects unreadable documents rather than fabricating experience", async () => {
    await expect(uploadStoredSource(new File([new Uint8Array([0, 1, 2, 3])], "resume.docx"), null)).rejects.toThrow();
  });
  it("does not create repository evidence without fetching repository content", () => {
    expect(() => addStoredGithubSource("project-core", "https://github.com/example/repo")).toThrow();
    expect(searchStoredEvidence("repository architecture")).toEqual([]);
  });
  it("honors disabled retention", () => {
    const session = createStoredSession({ retention: false });
    addTurnToStoredSession(session.id, { id: "t", role: "interviewer", text: "Private question", created_at: new Date().toISOString() });
    expect(getStoredSession(session.id)?.turns).toEqual([]);
  });
  it("replaces an enriched turn rather than duplicating it or double-counting questions", () => {
    const session = createStoredSession({ retention: true });
    const turn = { id: "t", role: "interviewer" as const, text: "Question", question: "Question", answer: "First", created_at: new Date().toISOString() };
    addTurnToStoredSession(session.id, turn);
    addTurnToStoredSession(session.id, { ...turn, answer: "Final" });
    expect(getStoredSession(session.id)?.turns).toEqual([{ ...turn, answer: "Final" }]);
    expect(getStoredSession(session.id)?.metrics.questions).toBe(1);
  });
  it("reports storage quota failures instead of pretending a save succeeded", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => { throw new DOMException("Full", "QuotaExceededError"); } } });
    expect(() => updateStoredUser({ name: "Saved?" })).toThrow(/storage|space|save/i);
  });
  it("deletes project source content with the project", async () => {
    const source = await uploadStoredSource(new File(["Built a Python payments service with idempotent requests."], "project.txt"), "project-core");
    deleteStoredProject("project-core");
    expect(getStoredSourceContent(source.id)).toBeNull();
  });
  it("persists a profile save", () => {
    updateStoredUser({ name: "Alex", preferences: { company: "Acme" } });
    expect(getStoredUser()).toMatchObject({ name: "Alex", preferences: { company: "Acme" } });
  });
  it("defaults relevant examples on and persists an explicit opt-out", () => {
    expect(getStoredUser().preferences?.include_simple_example).toBe(true);
    updateStoredUser({ preferences: { include_simple_example: false } });
    expect(getStoredUser().preferences?.include_simple_example).toBe(false);
  });
  it("rolls back a source if content storage exceeds the quota", async () => {
    getStoredUser();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (key.startsWith("interviewpilot_source_content_")) throw new DOMException("Full", "QuotaExceededError"); values.set(key, value); },
      removeItem: (key: string) => values.delete(key),
    } });
    await expect(uploadStoredSource(new File(["Real project evidence with Redis and Python."], "project.txt"), null)).rejects.toThrow(/storage/i);
    expect(getStoredSources()).toEqual([]);
    expect(searchStoredEvidence("Redis")).toEqual([]);
  });
});
