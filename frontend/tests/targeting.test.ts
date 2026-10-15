import { describe, expect, it } from "vitest";
import { findCompany, searchCompanies, companyContext } from "@/lib/companies";
import { generateHumanAnswer } from "@/lib/knowledge-engine";
import type { Preferences } from "@/lib/types";

describe("company and role targeting", () => {
  it("finds companies by name and alias", () => {
    expect(searchCompanies("amaz").map(c => c.name)).toContain("Amazon");
    expect(searchCompanies("face").map(c => c.name)).toContain("Meta");
    expect(searchCompanies("tcs").map(c => c.name)).toContain("TCS");
    expect(searchCompanies("wip").map(c => c.name)).toContain("Wipro");
    expect(searchCompanies("lum").map(c => c.name)).toContain("Lumen");
    expect(findCompany("facebook")?.name).toBe("Meta");
  });

  it("tails offline answers to the selected company without pointers in natural mode", () => {
    const prefs: Preferences = { response_delivery: "natural", english_level: "everyday", answer_style: "detailed", company: "Amazon", role: "SDE II" };
    const { answer } = generateHumanAnswer("what is dictionary in Python", "SDE II", prefs);
    expect(answer).toContain("Amazon");
    expect(answer).not.toMatch(/^\s*[•\-\*]\s+/m);
    expect(answer).not.toContain("**");
  });

  it("keeps concise natural answers short and pointer-free with a company set", () => {
    const { answer } = generateHumanAnswer("what is dictionary in Python", "SDE II", {
      response_delivery: "natural", english_level: "simple", answer_style: "concise", company: "TCS",
    });
    expect(answer.split(/\s+/).length).toBeLessThan(60);
    expect(answer).not.toMatch(/^\s*[•\-\*]\s+/m);
  });

  it("builds a company context line for prompts", () => {
    expect(companyContext("Amazon", "SDE II")).toContain("Amazon");
    expect(companyContext("", "SDE II")).toContain("No target company");
  });
});
