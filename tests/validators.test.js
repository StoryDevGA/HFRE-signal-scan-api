const test = require("node:test");
const assert = require("node:assert/strict");

const { llmOutputSchema, publicScanSchema } = require("../src/validators/schemas");

test("publicScanSchema accepts valid payload", () => {
  const result = publicScanSchema.safeParse({
    name: "Test User",
    email: "test@example.com",
    company_name: "Acme Inc",
    homepage_url: "https://acme.example",
    product_name: "Widget",
    product_page_url: "https://acme.example/widget",
  });

  assert.equal(result.success, true);
});

test("llmOutputSchema rejects missing metadata", () => {
  const result = llmOutputSchema.safeParse({
    company: "Acme Inc",
    internal_report: "Internal details",
    customer_report: "Customer details",
  });

  assert.equal(result.success, false);
});
