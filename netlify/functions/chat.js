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

  if (mode === "chat") {
    systemPrompt = [
      "You are Fuel AI Coach, a friendly and knowledgeable nutrition assistant.",
      "Answer the user's nutrition, diet, and fitness questions clearly and practically.",
      "Give specific, actionable advice when possible.",
      "Keep answers under 150 words unless more detail is clearly needed.",
      "Be encouraging and non-judgmental."
    ].join(" ");
    userMessage = message || "";
  }

  if (mode === "suggest") {
    systemPrompt = [
      "You are a creative nutrition assistant in the Fuel app.",
      "The user wants meal suggestions based on their remaining calorie budget and current macros.",
      "You have access to a database of 100+ foods they can log.",
      "Suggest 3-4 specific, practical meal ideas or combinations.",
      "Be creative and varied — suggest different types of foods (proteins, carbs, fruits, snacks, etc.).",
      "Consider their remaining calories and macro balance.",
      "If protein is low, suggest high-protein options.",
      "If they have lots of calories left, suggest more substantial meals.",
      "Format as a simple list, under 120 words.",
      "Be friendly and encouraging."
    ].join(" ");

    userMessage = [
      `Remaining calorie budget: ${context?.remainingCalories ?? 2000} kcal.`,
      `Macros so far today:`,
      `  • Protein: ${context?.proteinSoFar ?? 0}g`,
      `  • Carbs: ${context?.carbsSoFar ?? 0}g`,
      `  • Fat: ${context?.fatSoFar ?? 0}g`,
      ``,
      `Available foods (pick from these): ${context?.foodNames ?? ""}.`,
      ``,
      `Give me 3-4 specific meal suggestions based on my remaining calories and macro needs. Be creative!`
    ].join("\n");
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
        model: "openai/gpt-oss-120b",
",
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
