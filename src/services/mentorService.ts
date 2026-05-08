import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function getMentorAdvice(telemetry: any, deathReason: string | null) {
  const prompt = `
    You are "The Mentor", an expert racing engine tuner. 
    Current Telemetry: ${JSON.stringify(telemetry)}
    Engine Status: ${deathReason ? "DEAD" : "RUNNING"}
    Death Reason: ${deathReason || "N/A"}

    Provide a very short, precise, and educational piece of advice (max 2 sentences).
    If the engine died, briefly explain why and what to change.
    If the engine is running, give a quick pro-tip.
    Use tactical, professional tuning language.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text?.trim() || "Keep an eye on that AFR. Stability is key.";
  } catch (error) {
    console.error("Mentor error:", error);
    return "The telemetry is noisy. Check your connections.";
  }
}

export async function chatWithMentor(message: string, history: {role: 'user' | 'mentor', text: string}[], telemetry: any, deathReason: string | null) {
  const systemInstruction = `
    You are "SSF Tuning Mentor", an expert racing engine tuner and performance specialist.
    Your goal is to help the user tune their engine simulation.
    You have access to real-time telemetry and engine status.
    Current Telemetry: ${JSON.stringify(telemetry)}
    Engine Status: ${deathReason ? "DEAD" : "RUNNING"}
    Death Reason: ${deathReason || "N/A"}

    Keep your responses professional, tactical, and helpful. 
    Reference specific telemetry data when relevant (e.g., "AFR 15.2: too lean").
    Advise them on Fuel and Timing maps.
    Be extremely concise, precise, and direct. Keep answers very short.
  `;

  const contents = [
    ...history.map(m => ({
      role: m.role === 'mentor' ? 'model' : 'user',
      parts: [{ text: m.text }]
    })),
    { role: 'user', parts: [{ text: message }] }
  ];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview", // Use Pro for more complex chat reasoning
      contents,
      config: {
        systemInstruction,
      }
    });

    return response.text?.trim() || "I'm processing the data. Speak to me again.";
  } catch (error) {
    console.error("Mentor chat error:", error);
    return "I lost the data link for a second. What were we saying?";
  }
}
