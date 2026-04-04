import OpenAI from "openai";
import { buildOmniEnginePrompt } from "./src/ai-engine/prompt.js";

const nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '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',
});

async function main() {
    const sysPrompt = buildOmniEnginePrompt({}, null);
    const stream = await nvidiaClient.chat.completions.create({
        model: "google/gemma-4-31b-it",
        messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: "CREATE THIS GAME:\nMake an intense horror survival game" }
        ],
        max_tokens: 8192,
        temperature: 0.7,
        stream: true
    });
    
    let res = "";
    for await (const chunk of stream) {
        process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }
}
main();
