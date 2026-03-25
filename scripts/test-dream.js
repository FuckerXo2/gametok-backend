import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildOmniEnginePrompt } from '../src/ai-engine/prompt.js';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview", generationConfig: { responseMimeType: "application/json" }});
const sys = buildOmniEnginePrompt({});
model.generateContent([sys, "User Prompt: A relaxing color-matching puzzle game with chain combos"])
.then(res => console.log(JSON.stringify(res.response.text(), null, 2)))
.catch(err => console.error(err));
