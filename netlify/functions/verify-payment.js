// Netlify serverless function — verifies a Razorpay payment signature
// Requires environment variable: RAZORPAY_KEY_SECRET
// This MUST run server-side — never trust a "payment succeeded" claim from the browser alone.

const crypto = require("crypto");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return { statusCode: 500, body: JSON.stringify({ error: "RAZORPAY_KEY_SECRET is not set." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing payment details." }) };
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    return { statusCode: 400, body: JSON.stringify({ verified: false, error: "Signature mismatch — payment could not be verified." }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ verified: true, paymentId: razorpay_payment_id, orderId: razorpay_order_id })
  };
};
