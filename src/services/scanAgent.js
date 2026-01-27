const { StateGraph, END } = require("@langchain/langgraph");
const { ChatOpenAI } = require("@langchain/openai");
const { z } = require("zod");
const { llmOutputSchema, publicScanSchema } = require("../validators/schemas");

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
}

let cachedOpenAIClient = null;

function getOpenAIClient() {
  if (!cachedOpenAIClient) {
    // Lazy load to avoid requiring openai during tests if not installed yet.
    // eslint-disable-next-line global-require
    const OpenAI = require("openai");
    cachedOpenAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return cachedOpenAIClient;
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
    llmConfig: z.any().optional(),
    runMeta: runMetaSchema.optional(),
  })
  .strict();

const scanGraphStateSchema = z
  .object({
    systemPrompt: z.string().min(1),
    userPrompt: z.string().min(1),
    formInputs: publicScanSchema,
    llmConfig: z.any().optional(),
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

function getResponseFormat() {
  const raw = (process.env.LLM_RESPONSE_FORMAT || "").trim().toLowerCase();
  if (raw === "json" || raw === "json_object") {
    return { type: "json_object" };
  }
  return null;
}

function parseBooleanEnv(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

function normalizeReasoningEffort(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw || raw === "none") {
    return null;
  }
  if (raw === "xhigh") {
    console.warn("LLM_REASONING_EFFORT xhigh is not supported; using high.");
    return "high";
  }
  if (["low", "medium", "high"].includes(raw)) {
    return raw;
  }
  return null;
}

function normalizeTextVerbosity(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return null;
  return ["low", "medium", "high"].includes(raw) ? raw : null;
}

function isGpt5Family(modelName) {
  return /^gpt-5/i.test(modelName || "");
}

function isGpt52Family(modelName) {
  return /^gpt-5\.2/i.test(modelName || "");
}

function isGpt52Pro(modelName) {
  return /^gpt-5\.2-pro/i.test(modelName || "");
}

function isGpt51Family(modelName) {
  return /^gpt-5\.1/i.test(modelName || "");
}

function isGpt5MiniOrNano(modelName) {
  return /^gpt-5-(mini|nano)/i.test(modelName || "");
}

function shouldUseResponsesApi(modelName, override) {
  if (override === true || override === false) {
    return override;
  }
  return isGpt52Family(modelName);
}

function shouldApplyTemperature(modelName, reasoningEffort) {
  if (!isGpt5Family(modelName)) {
    return true;
  }
  if (isGpt52Pro(modelName)) {
    return false;
  }
  if (isGpt5MiniOrNano(modelName)) {
    return false;
  }
  if (isGpt52Family(modelName) || isGpt51Family(modelName)) {
    return !reasoningEffort;
  }
  return false;
}

function isTemperatureUnsupportedError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("unsupported parameter") && message.includes("temperature");
}

function normalizeModelName(rawModel) {
  const normalized = String(rawModel || "").replace("openai:", "");
  if (normalized.toLowerCase().includes("codex")) {
    console.warn("Codex models are disabled; falling back to gpt-5.2.", {
      requestedModel: normalized,
    });
    return "gpt-5.2";
  }
  if (normalized.toLowerCase() === "gpt-5.2-pro") {
    console.warn("gpt-5.2-pro is disabled; falling back to gpt-5.2.", {
      requestedModel: normalized,
    });
    return "gpt-5.2";
  }
  return normalized || "gpt-5.2";
}

function resolveLlmConfig(config) {
  const fallbackModel =
    process.env.LLM_MODEL_FIXED ||
    process.env.LLM_MODEL ||
    process.env.LLM_MODEL_LARGE ||
    process.env.LLM_MODEL_SMALL ||
    "gpt-5.2";
  const fallbackTemp = Number(process.env.LLM_TEMPERATURE || "0.2");
  const envUseResponses = parseBooleanEnv(process.env.LLM_USE_RESPONSES_API);
  const textVerbosity = normalizeTextVerbosity(process.env.LLM_TEXT_VERBOSITY);

  const sanitized = config && typeof config === "object" ? config : {};
  const hasTemperature = Object.prototype.hasOwnProperty.call(
    sanitized,
    "temperature"
  );
  const hasReasoningEffort = Object.prototype.hasOwnProperty.call(
    sanitized,
    "reasoningEffort"
  );
  const rawModel =
    sanitized.modelFixed ||
    sanitized.model ||
    sanitized.modelLarge ||
    sanitized.modelSmall ||
    fallbackModel;
  const reasoningSource = hasReasoningEffort
    ? sanitized.reasoningEffort
    : process.env.LLM_REASONING_EFFORT;
  const reasoningEffort = normalizeReasoningEffort(reasoningSource);

  return {
    temperature: hasTemperature
      ? sanitized.temperature
      : Number.isNaN(fallbackTemp)
      ? 0.2
      : fallbackTemp,
    modelFixed: normalizeModelName(rawModel),
    reasoningEffort,
    textVerbosity,
    useResponsesApi: envUseResponses,
  };
}

function selectModelName(resolved) {
  return resolved.modelFixed;
}

async function invokeResponsesApi({
  modelName,
  systemPrompt,
  userPrompt,
  responseFormat,
  temperature,
  maxTokens,
  reasoningEffort,
  textVerbosity,
  runMeta,
}) {
  const client = getOpenAIClient();
  const basePayload = {
    model: modelName,
    instructions: systemPrompt,
    input: userPrompt,
  };

  if (typeof temperature === "number") {
    basePayload.temperature = temperature;
  }

  if (typeof maxTokens === "number" && maxTokens > 0) {
    basePayload.max_output_tokens = maxTokens;
  }

  if (reasoningEffort) {
    basePayload.reasoning = { effort: reasoningEffort };
  }

  let payload = basePayload;
  if (responseFormat || textVerbosity) {
    payload = {
      ...basePayload,
      text: {
        ...(responseFormat ? { format: responseFormat } : {}),
        ...(textVerbosity ? { verbosity: textVerbosity } : {}),
      },
    };
  }

  let response;
  try {
    response = await client.responses.create(payload);
  } catch (error) {
    if (isTemperatureUnsupportedError(error) && "temperature" in basePayload) {
      console.warn("Temperature rejected; retrying without it.", {
        runMeta,
        stage: "invoke_llm",
        modelName,
      });
      const retryPayload = { ...payload };
      delete retryPayload.temperature;
      try {
        response = await client.responses.create(retryPayload);
      } catch (retryError) {
        if (payload !== basePayload) {
          console.warn("Responses API optional settings failed; retrying without them.", {
            runMeta,
            stage: "invoke_llm",
          });
          const strippedPayload = { ...basePayload };
          delete strippedPayload.temperature;
          response = await client.responses.create(strippedPayload);
        } else {
          throw retryError;
        }
      }
    } else if (payload !== basePayload) {
      console.warn("Responses API optional settings failed; retrying without them.", {
        runMeta,
        stage: "invoke_llm",
      });
      response = await client.responses.create(basePayload);
    } else {
      throw error;
    }
  }

  const tokenUsage = response?.usage
    ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      }
    : null;

  return {
    content: response?.output_text || "",
    tokenUsage,
  };
}

async function validateInputNode(state) {
  const normalizedFormInputs = normalizeFormInputs(state.formInputs);
  const parsed = scanGraphInputSchema.safeParse({
    systemPrompt: state.systemPrompt,
    userPrompt: state.userPrompt,
    formInputs: normalizedFormInputs,
    llmConfig: state.llmConfig,
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
    const resolved = resolveLlmConfig(state.llmConfig);
    const selectedModel = selectModelName(resolved);
    const modelName = normalizeModelName(selectedModel);
    const reasoningEffort = isGpt5Family(modelName)
      ? resolved.reasoningEffort
      : null;
    const verbosity = resolved.textVerbosity;
    const supportsTemperature = shouldApplyTemperature(
      modelName,
      reasoningEffort
    );
    const temperature =
      supportsTemperature && typeof resolved.temperature === "number"
        ? resolved.temperature
        : null;
    if (!supportsTemperature && typeof resolved.temperature === "number") {
      console.warn("Temperature suppressed for model compatibility.", {
        modelName,
        reasoningEffort,
      });
    }
    const maxTokens = Number(process.env.LLM_MAX_TOKENS || "0");
    const outputGuard =
      "\n\nReturn only valid JSON. Do not include Markdown or code fences.";
    const responseFormat = getResponseFormat();
    const useResponsesApi = shouldUseResponsesApi(
      modelName,
      resolved.useResponsesApi
    );

    const systemPrompt = `${state.systemPrompt}${outputGuard}`;
    const userPrompt = interpolatePrompt(state.userPrompt, state.formInputs);

    if (useResponsesApi) {
      const response = await invokeResponsesApi({
        modelName,
        systemPrompt,
        userPrompt,
        responseFormat,
        temperature: supportsTemperature ? resolved.temperature : null,
        maxTokens,
        reasoningEffort,
        textVerbosity: verbosity,
        runMeta: state.runMeta,
      });

      return {
        ...state,
        rawOutput: response.content,
        tokenUsage: response.tokenUsage,
        modelName,
        temperature,
        error: null,
        stage: "invoke_llm",
      };
    }

    const makeChatModel = (withTemperature) =>
      new ChatOpenAI({
        modelName,
        temperature: withTemperature ? resolved.temperature : undefined,
        maxTokens: maxTokens > 0 ? maxTokens : undefined,
        reasoningEffort: reasoningEffort || undefined,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });

    let model = makeChatModel(supportsTemperature);
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const invokeChat = async (options) => {
      if (options) {
        return model.invoke(messages, options);
      }
      return model.invoke(messages);
    };

    let response;
    if (responseFormat) {
      try {
        response = await invokeChat({ response_format: responseFormat });
      } catch (error) {
        if (isTemperatureUnsupportedError(error) && supportsTemperature) {
          console.warn("Temperature rejected; retrying without it.", {
            runMeta: state.runMeta,
            stage: "invoke_llm",
            modelName,
          });
          model = makeChatModel(false);
          response = await invokeChat({ response_format: responseFormat });
        } else {
          console.warn("response_format failed; retrying without it.", {
            runMeta: state.runMeta,
            stage: "invoke_llm",
          });
          response = await invokeChat();
        }
      }
    } else {
      try {
        response = await invokeChat();
      } catch (error) {
        if (isTemperatureUnsupportedError(error) && supportsTemperature) {
          console.warn("Temperature rejected; retrying without it.", {
            runMeta: state.runMeta,
            stage: "invoke_llm",
            modelName,
          });
          model = makeChatModel(false);
          response = await invokeChat();
        } else {
          throw error;
        }
      }
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
      llmConfig: { value: (x, y) => y ?? x ?? null },
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
async function runScanAgent({
  systemPrompt,
  userPrompt,
  formInputs,
  runMeta,
  llmConfig,
}) {
  ensureOpenAIKey();
  const graph = buildScanGraph();
  
  const result = await graph.invoke({
    systemPrompt,
    userPrompt,
    formInputs,
    llmConfig: llmConfig || null,
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
