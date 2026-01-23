const { StateGraph, END } = require("@langchain/langgraph");
const { ChatOpenAI } = require("@langchain/openai");
const { z } = require("zod");
const { llmOutputSchema, publicScanSchema } = require("../validators/schemas");

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
}

// Cached compiled graph (singleton)
let cachedGraph = null;

const runMetaSchema = z
  .object({
    submissionId: z.string().optional(),
    requestId: z.string().optional(),
  })
  .strict();

const scanGraphInputSchema = z
  .object({
    systemPrompt: z.string().min(1),
    userPrompt: z.string().min(1),
    formInputs: publicScanSchema,
    runMeta: runMetaSchema.optional(),
  })
  .strict();

const scanGraphStateSchema = z
  .object({
    systemPrompt: z.string().min(1),
    userPrompt: z.string().min(1),
    formInputs: publicScanSchema,
    rawOutput: z.any().nullable().optional(),
    parsedOutput: z.any().nullable().optional(),
    validatedOutput: llmOutputSchema.nullable().optional(),
    tokenUsage: z.any().nullable().optional(),
    error: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    modelName: z.string().nullable().optional(),
    temperature: z.number().nullable().optional(),
    runMeta: runMetaSchema.optional(),
  })
  .strict();

// Input sanitization to prevent prompt injection
function sanitizeInput(value) {
  if (value == null) return "";
  // Convert to string and remove control characters and excessive whitespace
  return String(value)
    .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 10000); // Limit length
}

function interpolatePrompt(template, inputs) {
  return template.replace(/\{\{\s*\$form\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = inputs[key];
    return sanitizeInput(value);
  });
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();

  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct !== null) {
    return direct;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced !== null) {
      return fenced;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const sliced = trimmed.slice(firstBrace, lastBrace + 1);
    const bracketed = tryParse(sliced);
    if (bracketed !== null) {
      return bracketed;
    }
  }

  return value;
}

function normalizeFormInputs(formInputs) {
  if (!formInputs) {
    return formInputs;
  }
  if (typeof formInputs.toObject === "function") {
    return formInputs.toObject({ depopulate: true });
  }
  if (typeof formInputs.toJSON === "function") {
    return formInputs.toJSON();
  }
  return formInputs;
}

function estimateInputSize(state) {
  const systemPrompt = state.systemPrompt || "";
  const userPrompt = state.userPrompt || "";
  let formInputsSize = 0;
  try {
    formInputsSize = JSON.stringify(state.formInputs || {}).length;
  } catch (error) {
    formInputsSize = 0;
  }
  return systemPrompt.length + userPrompt.length + formInputsSize;
}

function getResponseFormat() {
  const raw = (process.env.LLM_RESPONSE_FORMAT || "").trim().toLowerCase();
  if (raw === "json" || raw === "json_object") {
    return { type: "json_object" };
  }
  return null;
}

function selectModelName(state) {
  const smallModel =
    process.env.LLM_MODEL_SMALL || process.env.LLM_MODEL || "gpt-4o-mini";
  const largeModel = process.env.LLM_MODEL_LARGE || "gpt-4o";
  const threshold = Number(process.env.LLM_LARGE_THRESHOLD || "6000");
  const inputSize = estimateInputSize(state);
  return inputSize >= threshold ? largeModel : smallModel;
}

async function validateInputNode(state) {
  const normalizedFormInputs = normalizeFormInputs(state.formInputs);
  const parsed = scanGraphInputSchema.safeParse({
    systemPrompt: state.systemPrompt,
    userPrompt: state.userPrompt,
    formInputs: normalizedFormInputs,
    runMeta: state.runMeta,
  });

  if (!parsed.success) {
    console.error("Scan agent input validation failed:", {
      issues: parsed.error.issues,
      runMeta: state.runMeta,
      stage: "validate_input",
    });
    return {
      ...state,
      error: "Invalid scan agent input.",
      stage: "validate_input",
    };
  }

  return {
    ...state,
    ...parsed.data,
    formInputs: normalizedFormInputs,
    error: null,
    stage: "validate_input",
  };
}

// Node 1: Invoke LLM
async function invokeLLMNode(state) {
  try {
    const modelName = selectModelName(state);
    const temperature = Number(process.env.LLM_TEMPERATURE || "0.2");
    const maxTokens = Number(process.env.LLM_MAX_TOKENS || "0");
    const outputGuard =
      "\n\nReturn only valid JSON. Do not include Markdown or code fences.";
    const responseFormat = getResponseFormat();

    const model = new ChatOpenAI({
      modelName: modelName.replace("openai:", ""),
      temperature,
      maxTokens: maxTokens > 0 ? maxTokens : undefined,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const messages = [
      { role: "system", content: `${state.systemPrompt}${outputGuard}` },
      {
        role: "user",
        content: interpolatePrompt(state.userPrompt, state.formInputs),
      },
    ];

    let response;
    if (responseFormat) {
      try {
        response = await model.invoke(messages, {
          response_format: responseFormat,
        });
      } catch (error) {
        console.warn("response_format failed; retrying without it.", {
          runMeta: state.runMeta,
          stage: "invoke_llm",
        });
        response = await model.invoke(messages);
      }
    } else {
      response = await model.invoke(messages);
    }
    const tokenUsage =
      response?.response_metadata?.tokenUsage ||
      response?.usage_metadata ||
      null;
    
    let content = "";
    if (response && typeof response === "object" && "content" in response) {
      const responseContent = response.content;
      if (Array.isArray(responseContent)) {
        content = responseContent
          .map((part) => (part && part.text ? part.text : ""))
          .join("");
      } else {
        content = String(responseContent);
      }
    } else {
      content = String(response);
    }

    return {
      ...state,
      rawOutput: content,
      tokenUsage,
      modelName,
      temperature,
      error: null,
      stage: "invoke_llm",
    };
  } catch (error) {
    console.error("LLM invocation error:", {
      error,
      runMeta: state.runMeta,
      stage: "invoke_llm",
    });
    return {
      ...state,
      error: error.message || "LLM invocation failed",
      stage: "invoke_llm",
    };
  }
}

// Node 2: Parse and validate output
async function parseOutputNode(state) {
  if (state.error) {
    return state;
  }

  try {
    const parsed = parseMaybeJson(state.rawOutput);
    return { ...state, parsedOutput: parsed, error: null, stage: "parse_output" };
  } catch (error) {
    console.error("Parse error:", {
      error,
      rawOutputSnippet:
        typeof state.rawOutput === "string"
          ? state.rawOutput.slice(0, 300)
          : String(state.rawOutput || "").slice(0, 300),
      runMeta: state.runMeta,
      stage: "parse_output",
    });
    return {
      ...state,
      error: "Failed to parse LLM output",
      stage: "parse_output",
    };
  }
}

async function validateOutputNode(state) {
  if (state.error) {
    return { ...state, stage: "validate_output" };
  }

  const validated = llmOutputSchema.safeParse(state.parsedOutput);
  if (!validated.success) {
    console.error("LLM output schema validation failed:", {
      issues: validated.error.issues,
      rawOutputSnippet:
        typeof state.rawOutput === "string"
          ? state.rawOutput.slice(0, 300)
          : String(state.rawOutput || "").slice(0, 300),
      runMeta: state.runMeta,
      stage: "validate_output",
    });
    return {
      ...state,
      error: "LLM output did not match schema.",
      validatedOutput: null,
      stage: "validate_output",
    };
  }

  return {
    ...state,
    validatedOutput: validated.data,
    error: null,
    stage: "validate_output",
  };
}

async function errorNode(state) {
  if (!state.error) {
    return { ...state, error: "Unknown error", stage: "error" };
  }
  return { ...state, stage: "error" };
}

// Build the fixed agent graph
function buildScanGraph() {
  // Return cached graph if available
  if (cachedGraph) {
    return cachedGraph;
  }

  const graph = new StateGraph({
    channels: {
      systemPrompt: { value: (x, y) => y ?? x ?? null },
      userPrompt: { value: (x, y) => y ?? x ?? null },
      formInputs: { value: (x, y) => y ?? x ?? null },
      rawOutput: { value: (x, y) => y ?? x ?? null },
      parsedOutput: { value: (x, y) => y ?? x ?? null },
      validatedOutput: { value: (x, y) => y ?? x ?? null },
      tokenUsage: { value: (x, y) => y ?? x ?? null },
      error: { value: (x, y) => y ?? x ?? null },
      stage: { value: (x, y) => y ?? x ?? null },
      modelName: { value: (x, y) => y ?? x ?? null },
      temperature: { value: (x, y) => y ?? x ?? null },
      runMeta: { value: (x, y) => y ?? x ?? null },
    },
  });

  // Add nodes to the graph
  graph.addNode("validateInput", validateInputNode);
  graph.addNode("invokeLLM", invokeLLMNode);
  graph.addNode("parseOutput", parseOutputNode);
  graph.addNode("validateOutput", validateOutputNode);
  graph.addNode("handleError", errorNode);

  // Define edges
  graph.addConditionalEdges("validateInput", (state) =>
    state.error ? "handleError" : "invokeLLM"
  );
  graph.addEdge("invokeLLM", "parseOutput");
  graph.addConditionalEdges("parseOutput", (state) =>
    state.error ? "handleError" : "validateOutput"
  );
  graph.addConditionalEdges("validateOutput", (state) =>
    state.error ? "handleError" : END
  );
  graph.addEdge("handleError", END);

  // Set entry point
  graph.setEntryPoint("validateInput");

  // Cache and return
  cachedGraph = graph.compile();
  return cachedGraph;
}

// Main function to run the scan agent
async function runScanAgent({ systemPrompt, userPrompt, formInputs, runMeta }) {
  ensureOpenAIKey();
  const graph = buildScanGraph();
  
  const result = await graph.invoke({
    systemPrompt,
    userPrompt,
    formInputs,
    runMeta: runMeta || null,
    rawOutput: null,
    parsedOutput: null,
    validatedOutput: null,
    tokenUsage: null,
    error: null,
    stage: null,
    modelName: null,
    temperature: null,
  });

  return {
    output: result.validatedOutput || null,
    rawOutput: result.rawOutput || null,
    parsedOutput: result.parsedOutput || null,
    tokenUsage: result.tokenUsage || null,
    error: result.error || null,
    stage: result.stage || null,
    modelName: result.modelName || null,
    temperature:
      typeof result.temperature === "number" ? result.temperature : null,
  };
}

module.exports = {
  interpolatePrompt,
  runScanAgent,
  buildScanGraph,
  parseMaybeJson,
  scanGraphStateSchema,
};
