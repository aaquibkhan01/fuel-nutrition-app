// Netlify serverless function — runs server-side only.
// Keeps the Anthropic API key out of the browser entirely.
//
// Requires an environment variable set in Netlify:
//   ANTHROPIC_API_KEY = sk-ant-...
// (Site settings → Environment variables → Add a variable)

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set in Netlify environment variables." })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { mode, message, context } = body;

  let system = "";
  let userText = "";

  if (mode === "suggest") {
    system = [
      "You are a nutrition assistant built into a food tracking app called Fuel.",
      "Suggest 2-3 specific things the user could eat next, using ONLY items from the provided food list (use the exact food names).",
      "Prioritize protein if the user's protein intake so far looks low relative to a typical daily need.",
      "Stay within the remaining calorie budget given.",
      "Be concise and practical — under 120 words. No markdown headers, just short plain sentences or a short list.",
      "You are not a doctor; do not give medical advice."
    ].join(" ");

    userText = [
      `Remaining calorie budget today: ${context?.remainingCalories ?? "unknown"} kcal.`,
      `So far today — protein: ${context?.proteinSoFar ?? 0}g, carbs: ${context?.carbsSoFar ?? 0}g, fat: ${context?.fatSoFar ?? 0}g.`,
      `Foods available in the app's database: ${context?.foodNames ?? ""}.`,
      "Suggest what to eat next."
    ].join("\n");
  } else {
    system = [
      "You are a friendly, knowledgeable nutrition and fitness assistant built into a food tracking app called Fuel.",
      "Give clear, practical, evidence-based answers about diet, nutrition, and fitness.",
      "Keep answers concise (under 150 words) unless the user clearly asks for more detail.",
      "You are not a doctor — for medical concerns, suggest the user consult a professional."
    ].join(" ");
    userText = message || "";
  }

  if (!userText.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Empty message." }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: userText }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Anthropic API error: ${errText}` }) };
    }

    const data = await response.json();
    const reply = (data.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: reply || "No response generated." })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
