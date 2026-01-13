const { Resend } = require("resend");

function parseRecipients(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  return new Resend(apiKey);
}

function getFromAddress() {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set.");
  }
  return from;
}

async function sendCustomerEmail({ to, company, customerReport }) {
  const resend = createResendClient();
  const from = getFromAddress();
  const subject = `HFRE Signal Scan - ${company || "Your report"}`;
  const text = customerReport || "";

  return resend.emails.send({
    from,
    to,
    subject,
    text,
  });
}

async function sendOwnerEmail({
  contactName,
  contactEmail,
  companyName,
  homepageUrl,
  productName,
  productPageUrl,
  confidenceLevel,
  customerReport,
  internalReport,
}) {
  const resend = createResendClient();
  const from = getFromAddress();
  const to = parseRecipients(process.env.EMAIL_TO_OWNERS);
  if (!to.length) {
    throw new Error("EMAIL_TO_OWNERS is not set.");
  }

  const subject = `New HFRE Signal Scan - ${companyName || "Submission"}`;
  const text = [
    `Contact Name: ${contactName || ""}`,
    `Contact Email: ${contactEmail || ""}`,
    `Company Name: ${companyName || ""}`,
    `Homepage URL: ${homepageUrl || ""}`,
    `Product Name: ${productName || ""}`,
    `Product Page URL: ${productPageUrl || ""}`,
    `Confidence Level: ${confidenceLevel || ""}`,
    "",
    "Customer Report:",
    customerReport || "",
    "",
    "Internal Report:",
    internalReport || "",
  ].join("\n");

  return resend.emails.send({
    from,
    to,
    subject,
    text,
  });
}

module.exports = {
  sendCustomerEmail,
  sendOwnerEmail,
};
