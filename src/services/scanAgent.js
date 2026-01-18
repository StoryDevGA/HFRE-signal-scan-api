const { StateGraph, END } = require("@langchain/langgraph");

function interpolatePrompt(template, inputs) {
  return template.replace(/\{\{\s*\$form\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = inputs[key];
    return value == null ? "" : String(value);
  });
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

// Node 1: Invoke LLM
async function invokeLLMNode(state) {
  try {
    const { ChatOpenAI } = require("@langchain/openai");
    const modelName = process.env.LLM_MODEL || "gpt-4o-mini";
    const temperature = Number(process.env.LLM_TEMPERATURE || "0.2");

    const model = new ChatOpenAI({
      modelName: modelName.replace("openai:", ""),
      temperature,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const messages = [
      { role: "system", content: state.systemPrompt },
      {
        role: "user",
        content: interpolatePrompt(state.userPrompt, state.formInputs),
      },
    ];

    const response = await model.invoke(messages);
    
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

    return { ...state, rawOutput: content, error: null };
  } catch (error) {
    console.error("LLM invocation error:", error);
    return { ...state, error: error.message || "LLM invocation failed" };
  }
}

// Node 2: Parse and validate output
async function parseOutputNode(state) {
  if (state.error) {
    return state;
  }

  try {
    const parsed = parseMaybeJson(state.rawOutput);
    return { ...state, parsedOutput: parsed, error: null };
  } catch (error) {
    console.error("Parse error:", error);
    return { ...state, error: "Failed to parse LLM output" };
  }
}

// Conditional edge: continue or error
function shouldContinue(state) {
  return state.error ? "error" : END;
}

// Build the fixed agent graph
async function buildScanGraph() {
  const graph = new StateGraph({
    channels: {
      systemPrompt: { value: (x, y) => y ?? x ?? null },
      userPrompt: { value: (x, y) => y ?? x ?? null },
      formInputs: { value: (x, y) => y ?? x ?? null },
      rawOutput: { value: (x, y) => y ?? x ?? null },
      parsedOutput: { value: (x, y) => y ?? x ?? null },
      error: { value: (x, y) => y ?? x ?? null },
    },
  });

  // Add nodes to the graph
  graph.addNode("invokeLLM", invokeLLMNode);
  graph.addNode("parseOutput", parseOutputNode);

  // Define edges
  graph.addEdge("invokeLLM", "parseOutput");
  graph.addConditionalEdges("parseOutput", shouldContinue);

  // Set entry point
  graph.setEntryPoint("invokeLLM");

  return graph.compile();
}

// Main function to run the scan agent
async function runScanAgent({ systemPrompt, userPrompt, formInputs }) {
  const graph = await buildScanGraph();
  
  const result = await graph.invoke({
    systemPrompt,
    userPrompt,
    formInputs,
    rawOutput: null,
    parsedOutput: null,
    error: null,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  return result.parsedOutput;
}

module.exports = {
  interpolatePrompt,
  runScanAgent,
  buildScanGraph,
};
