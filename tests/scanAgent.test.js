const test = require("node:test");
const assert = require("node:assert/strict");

const { interpolatePrompt } = require("../src/services/scanAgent");

test("interpolatePrompt replaces form tokens with values", () => {
  const template =
    "Company: {{ $form.company_name }} Email: {{ $form.email }}";
  const inputs = { company_name: "Acme Inc", email: "test@example.com" };
  const result = interpolatePrompt(template, inputs);
  assert.equal(result, "Company: Acme Inc Email: test@example.com");
});

test("interpolatePrompt leaves missing values blank", () => {
  const template = "Company: {{ $form.company_name }}";
  const result = interpolatePrompt(template, {});
  assert.equal(result, "Company: ");
});
