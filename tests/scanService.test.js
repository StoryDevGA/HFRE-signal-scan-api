const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const scanServicePath = path.resolve(
  __dirname,
  "../src/services/scanService.js"
);
const modelsPath = path.resolve(__dirname, "../src/models/index.js");
const promptServicePath = path.resolve(
  __dirname,
  "../src/services/promptService.js"
);
const scanAgentPath = path.resolve(
  __dirname,
  "../src/services/scanAgent.js"
);
const emailServicePath = path.resolve(
  __dirname,
  "../src/services/emailService.js"
);

function loadServiceWithMocks(mocks) {
  delete require.cache[scanServicePath];
  require.cache[modelsPath] = { exports: mocks.models };
  require.cache[promptServicePath] = { exports: mocks.promptService };
  require.cache[scanAgentPath] = { exports: mocks.scanAgent };
  require.cache[emailServicePath] = { exports: mocks.emailService };
  return require(scanServicePath);
}

function clearMocks() {
  delete require.cache[scanServicePath];
  delete require.cache[modelsPath];
  delete require.cache[promptServicePath];
  delete require.cache[scanAgentPath];
  delete require.cache[emailServicePath];
}

test("processSubmission marks failed when prompts missing", async () => {
  const submission = {
    status: "pending",
    inputs: { name: "Test", email: "test@example.com" },
    save: async () => {},
  };

  const { processSubmission } = loadServiceWithMocks({
    models: {
      Submission: {
        findById: async () => submission,
      },
    },
    promptService: {
      getActivePrompt: async () => null,
    },
    scanAgent: {
      runScanAgent: async () => ({}),
    },
    emailService: {
      sendCustomerEmail: async () => {},
      sendOwnerEmail: async () => {},
    },
  });

  await processSubmission("fake");
  assert.equal(submission.status, "failed");
  assert.equal(submission.failure?.message, "Active prompts not configured.");
  clearMocks();
});

test("processSubmission stores outputs and sends emails on success", async () => {
  let saveCount = 0;
  const submission = {
    status: "pending",
    inputs: {
      name: "Test User",
      email: "test@example.com",
      company_name: "Acme Inc",
      homepage_url: "https://acme.example",
      product_name: "Widget",
      product_page_url: "https://acme.example/widget",
    },
    save: async () => {
      saveCount += 1;
    },
  };

  const output = {
    company: "Acme Inc",
    internal_report: "Internal report",
    customer_report: "Customer report",
    metadata: {
      confidence_level: "High",
      source_scope: "Public website only",
      shareability: {
        customer_safe: true,
        internal_only: true,
      },
    },
  };

  let customerCalled = false;
  let ownerCalled = false;

  const { processSubmission } = loadServiceWithMocks({
    models: {
      Submission: {
        findById: async () => submission,
      },
    },
    promptService: {
      getActivePrompt: async (type) =>
        type === "system"
          ? { _id: "sys", version: 1, content: "system" }
          : { _id: "user", version: 1, content: "user" },
    },
    scanAgent: {
      runScanAgent: async () => ({ output }),
    },
    emailService: {
      sendCustomerEmail: async () => {
        customerCalled = true;
      },
      sendOwnerEmail: async () => {
        ownerCalled = true;
      },
    },
  });

  await processSubmission("fake");
  assert.equal(submission.status, "complete");
  assert.equal(submission.outputs.company, "Acme Inc");
  assert.equal(customerCalled, true);
  assert.equal(ownerCalled, true);
  assert.equal(saveCount >= 2, true);
  clearMocks();
});
