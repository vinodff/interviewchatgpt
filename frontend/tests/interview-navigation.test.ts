import { describe, expect, it } from "vitest";
import { interviewUrl, interviewView, legacyInterviewUrl } from "@/lib/interview-navigation";

describe("interview navigation", () => {
  it("links directly to the requested interview step", () => {
    expect(interviewView("live")).toBe("live");
    expect(interviewView("billing")).toBe("billing");
    expect(interviewView("not-a-page")).toBe("overview");
    expect(interviewUrl("live")).toBe("/interview?view=live");
  });
  it("preserves reset tokens and billing destinations in old links", () => {
    expect(legacyInterviewUrl({ reset: "a+b&c" })).toBe("/interview?reset=a%2Bb%26c");
    expect(legacyInterviewUrl({ billing: "success" })).toBe("/interview?billing=success&view=billing");
    expect(legacyInterviewUrl({ view: "live", signup: "1" })).toBe("/interview?view=live&signup=1");
  });
});
