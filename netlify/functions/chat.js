// Netlify serverless function — calls Groq API
// Requires environment variable: GROQ_API_KEY
// Rate limiting: uses the caller's own Firebase ID token to read/write a
// per-user counter in Firestore (via Firestore's REST API). No admin SDK
// or service account needed — Firestore's own security rules enforce that
// a user can only touch their own rate-limit document.

const FIREBASE_PROJECT_ID = "fuel-nutrition-a1890";
const RATE_LIMIT_MAX = 8;        // max AI requests
const RATE_LIMIT_WINDOW_MS = 120000; // per 2 minutes

function decodeUidFromToken(idToken) {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json).user_id || JSON.parse(json).sub;
  } catch (e) {
    return null;
  }
}

async function checkAndBumpRateLimit(idToken) {
  const uid = decodeUidFromToken(idToken);
  if (!uid) return { allowed: false, reason: "Invalid session, please log in again." };

  const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rateLimits/${uid}`;
  const headers = { "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" };

  let count = 0;
  let windowStart = Date.now();

  try {
    const getRes = await fetch(docUrl, { headers });
    if (getRes.ok) {
      const doc = await getRes.json();
      const fields = doc.fields || {};
      const existingWindowStart = fields.windowStart ? parseInt(fields.windowStart.integerValue || "0", 10) : 0;
      const existingCount = fields.count ? parseInt(fields.count.integerValue || "0", 10) : 0;

      if (Date.now() - existingWindowStart < RATE_LIMIT_WINDOW_MS) {
        windowStart = existingWindowStart;
        count = existingCount;
      }
    }
    // 404 (doc doesn't exist yet) just means this is their first request — defaults above apply.
  } catch (e) {
    // If Firestore is briefly unreachable, fail open rather than blocking legitimate users.
    return { allowed: true };
  }

  if (count >= RATE_LIMIT_MAX) {
    return { allowed: false, reason: "Too many requests — please wait a bit." };
  }

  // Write back the incremented count (best-effort — don't block the AI call if this fails)
  try {
    await fetch(`${docUrl}?updateMask.fieldPaths=count&updateMask.fieldPaths=windowStart`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        fields: {
          count: { integerValue: String(count + 1) },
          windowStart: { integerValue: String(windowStart) }
        }
      })
    });
  } catch (e) { /* non-fatal */ }

  return { allowed: true };
}

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

  const { mode, message, context, idToken } = body;

  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ error: "Missing session token." }) };
  }

  const rateCheck = await checkAndBumpRateLimit(idToken);
  if (!rateCheck.allowed) {
    return { statusCode: 429, body: JSON.stringify({ error: rateCheck.reason }) };
  }

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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 600,
        temperature: 0.7,
        reasoning_effort: "low"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Groq API error: ${errText}` }) };
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message || {};
    const reply = (msg.content || msg.reasoning || "No response generated.").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
