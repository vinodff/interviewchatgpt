import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([...nextVitals, ...nextTs, { files: ["public/audio/pcm-processor.js"], languageOptions: { globals: { AudioWorkletProcessor: "readonly", sampleRate: "readonly", registerProcessor: "readonly" } } }, globalIgnores([".next/**", "test-results/**", "playwright-report/**", "next-env.d.ts"])]);
