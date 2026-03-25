import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
async function test() {
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
  console.time("gemini");
  try {
    const res = await model.generateContent("hello");
    console.log(res.response.text());
  } catch (e) {
    console.error(e);
  }
  console.timeEnd("gemini");
}
test();
