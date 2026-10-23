/** Shared wire setup; credentials are minted only on the server. */
export const STREAMING_SPEECH_MODEL = "models/gemini-3.5-transcribe-live";
export const streamingSpeechSetup = () => ({
  model: STREAMING_SPEECH_MODEL,
  generationConfig: { responseModalities: ["TEXT"] },
  inputAudioTranscription: {
    languageCodes: ["en-IN", "en-US"],
    mode: "VERBATIM",
    customVocabulary: ["Python", "JavaScript", "TypeScript", "React", "SQL", "DBMS", "OOP", "abstract class", "polymorphism", "dictionary", "linked list", "time complexity", "C++", "C#", "Kubernetes", "PostgreSQL"],
  },
  realtimeInputConfig: { automaticActivityDetection: {
    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
    endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
    prefixPaddingMs: 300, silenceDurationMs: 500,
  } },
});

export type StreamingSpeechTicket = { token: string; expires_at: number };
