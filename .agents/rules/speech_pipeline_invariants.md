# Live Speech Processing & Turn Management Invariants

1. **Web Speech API Interim Result Handling**:
   - Never append or merge an interim result (`isFinal: false`) into an existing string using string-joining heuristics.
   - For any active recognition event, compute the current phrase as:
     `accumulated_final_chunks + current_interim_chunk`
   - Interim results must always replace previous interim results for that recognition window, never concatenate.

2. **Speaker Turn Isolation & Cross-Pause Stitching**:
   - Cross-pause stitching must strictly check speaker identity. Never stitch an utterance into a previous turn if `previousTurn.role === "user"` (candidate speech).
   - Never use broad substring inclusion (`text.includes(...)`) between prior turns and new speech to decide stitching. Only stitch if the prior turn ended on an explicit incomplete conjunction or connector (e.g., `tell me about`, `what about`).

3. **Follow-Up Question Protection (Self-Echo vs. Interview Questions)**:
   - Self-echo detection must never discard utterances that match question patterns or begin with question interrogatives (`what`, `how`, `why`, `can you`, `tell me`, `difference`).
   - Self-echo detection must require consecutive n-gram sequence matches (minimum 5 words in exact order), not generic bag-of-words percentage overlap.
   - Do not impose multi-second cooldowns that block fast conversational follow-ups. Only deduplicate identical consecutive questions within 4 seconds.
