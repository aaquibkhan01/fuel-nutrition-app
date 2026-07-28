// Netlify serverless function — calls Groq API
// Requires environment variable: GROQ_API_KEY

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "GROQ_API_KEY is not set in Netlify environment variables." })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { mode, message, context } = body;

  let systemPrompt = "";
  let userMessage = "";

  if (mode === "suggest") {
    systemPrompt = [
      "You are a nutrition assistant in a food tracking app called Fuel.",
      "Suggest 2-3 specific foods the user could eat next, using ONLY items from the provided food list (use exact food names).",
      "Prioritize protein if protein intake so far is low.",
      "Stay within the remaining calorie budget.",
      "Keep it under 100 words. Be practical and direct."
    ].join(" ");

    userMessage = [
      `Remaining calories today: ${context?.remainingCalories ?? "unknown"} kcal.`,
      `Today so far — Protein: ${context?.proteinSoFar ?? 0}g, Carbs: ${context?.carbsSoFar ?? 0}g, Fat: ${context?.fatSoFar ?? 0}g.`,
      `Available foods: ${context?.foodNames ?? ""}.`,
      "What should I eat next? Suggest from the list."
    ].join("\n");
  } else {
    systemPrompt = [
      "You are a friendly nutrition assistant in the Fuel app.",
      "Give practical, evidence-based nutrition advice.",
      "Keep answers under 120 words unless asked for more.",
      "You are not a doctor."
    ].join(" ");
    userMessage = message || "";
  }

  if (!userMessage.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Empty message." }) };
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gemma-2-9b-it",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Groq API error: ${errText}` }) };
    }

    const data = await response.json();
    const reply = (data.choices?.[0]?.message?.content || "No response generated.").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
