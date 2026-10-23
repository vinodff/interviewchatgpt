import { describe, expect, it } from "vitest";
import { embeddedRequest, briefTopicRequest, trailingTopicRequest, heardQuestionOptions, speechRequestFocus, isCapabilityNarration } from "../lib/speech-request";

describe("embedded interview requests", () => {
  it("detects the screenshot's trailing question independently of preceding candidate narration", () => {
    expect(embeddedRequest("the time complexity basically measures how execution grows with input size and avoids bottlenecks before production what is list")).toBe("what is list");
  });
  it("preserves multipart requests and constraints", () => {
    expect(embeddedRequest("What is a REST API? How do you implement one?")).toBe("What is a REST API? How do you implement one?");
    expect(embeddedRequest("Okay can you implement a queue in JavaScript?")).toBe("can you implement a queue in JavaScript?");
  });
  it("does not treat ordinary candidate narration as an explicit request cue", () => {
    expect(embeddedRequest("I used Redis and PostgreSQL in the last project.")).toBeNull();
  });
});

describe("short interview topics and multiple question choices", () => {
  it("recognizes a bare abstract prompt and preserves an explicit language", () => {
    expect(briefTopicRequest("Abstract")).toBe("Explain abstract classes.");
    expect(briefTopicRequest("Okay abstract class in Python please")).toBe("Explain abstract classes in Python.");
    expect(briefTopicRequest("DBMS")).toBe("Explain DBMS.");
    expect(speechRequestFocus("Abstract")).toBe("Abstract"); // Keep spoken intent distinct from a manual request.
  });
  it("recognizes the user's means prompts as definitions and keeps separate topic choices", () => {
    expect(briefTopicRequest("DATABASE MEANS ?")).toBe("Explain databases.");
    expect(briefTopicRequest("SQL means")).toBe("Explain SQL.");
    expect(briefTopicRequest("Python means")).toBe("Explain Python.");
    expect(briefTopicRequest("meaning of Python")).toBe("Explain Python.");
    expect(heardQuestionOptions("Database means, SQL means, Python means?")).toEqual(["Explain databases.", "Explain SQL.", "Explain Python."]);
    for (const text of ["I know what database means", "Python means a lot to me", "The interviewer asked SQL means", "I used a database in my project"]) expect(briefTopicRequest(text)).toBeNull();
  });
  it("separates the user's adjacent DBMS and abstract-class prompts", () => {
    const text = "Abstract classes okay. I explained my project in Python. What is DBMS? What is DB? what is DBMS abstract class";
    expect(trailingTopicRequest(text)).toBe("Explain abstract classes.");
    expect(speechRequestFocus(text)).toBe("abstract class");
    const options = heardQuestionOptions(text);
    expect(options).toContain("Explain abstract classes."); expect(options).toContain("What is DBMS"); expect(options).toContain("What is DB");
    expect(options.some(question => /DBMS abstract class/.test(question))).toBe(false);
  });
  it("handles multiple unpunctuated questions without splitting nested imperatives", () => {
    expect(heardQuestionOptions("What is DBMS what is an abstract class")).toEqual(["What is DBMS", "what is an abstract class"]);
    expect(heardQuestionOptions("How do you implement a stack in Python")).toEqual(["How do you implement a stack in Python"]);
    expect(heardQuestionOptions("Can you explain inheritance")).toEqual(["Can you explain inheritance"]);
  });
  it("does not split ordinary technical modifiers or promote narration and past questions", () => {
    expect(speechRequestFocus("What is a Python dictionary?")).toBe("What is a Python dictionary?");
    for (const text of ["An abstract class can have abstract methods", "I use DBMS in my project", "Yesterday he asked me what is DBMS", "what is", "can you explain the"]) expect(heardQuestionOptions(text)).toEqual([]);
    expect(speechRequestFocus("Yesterday he asked me what is DBMS")).toBe("Yesterday he asked me what is DBMS");
  });
  it("preserves qualified names, decimal versions, and reporting context", () => {
    for (const text of ["What is java.util.List?", "Explain React.Component.set", "What is Python 3.12?"]) expect(speechRequestFocus(text)).toBe(text);
    expect(heardQuestionOptions("What is java.util.List?")).toEqual(["What is java.util.List"]);
    for (const text of ["The interviewer asked what is a list?", "They asked, What is DBMS?", "I can describe polymorphism", "They asked what is DBMS in my last round"]) {
      expect(speechRequestFocus(text)).toBe(text); expect(heardQuestionOptions(text)).toEqual([]);
    }
    expect(heardQuestionOptions("They asked what is DBMS. Abstract class")).toEqual(["Explain abstract classes."]);
    expect(briefTopicRequest("__proto__")).toBeNull();
  });
  it("keeps candidate offers separate from first-person requests and later embedded questions", () => {
    expect(isCapabilityNarration("I can describe polymorphism.")).toBe(true);
    expect(isCapabilityNarration("Okay we will implement a stack in Python.")).toBe(true);
    for (const text of ["I want you to implement a stack in JavaScript", "I can describe polymorphism but can you explain an abstract class?", "Can you tell me how I can describe polymorphism", "I can describe polymorphism. What is a DBMS?", "I can describe polymorphism. Abstract class", "Could you explain polymorphism?"]) expect(isCapabilityNarration(text)).toBe(false);
  });
});
