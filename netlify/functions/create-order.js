// Netlify serverless function — creates a Razorpay Order
// Requires environment variables: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Razorpay keys are not set in Netlify environment variables." })
    };
  }

  const amount = 9900; // ₹99.00 in paise — fixed server-side so the client can't tamper with the price
  const currency = "INR";

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  try {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt: "fuel_" + Date.now(),
        payment_capture: 1
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Razorpay error: ${errText}` }) };
    }

    const order = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: keyId
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
