# API Implementation Plan (HFRE Signal Scan)

This plan aligns with langChain-langGraph.docx concepts like createAgent, initChatModel,
structured output via Zod, and optional LangGraph memory via MemorySaver.

1) Project bootstrap and config
- Initialize Node/Express app, env loading, and middleware (Helmet, CORS allowlist, JSON limits, logging).
- Add envs for DB, LLM provider, email provider, admin allowlist/hash.
- Foundation for LangChain agent runtime and model config.

2) Schema and validation layer
- Define Zod/Joi schemas for public scan input, admin auth, prompt CRUD.
- Define strict Zod schema for LLM output (company, internal_report, customer_report, metadata).
- Matches structured output guidance in langChain-langGraph.docx.

3) MongoDB models
- Create Mongoose models: submissions, prompts, analytics, adminAudit.
- Add indexes: publicId unique, inputs.email, createdAt.

4) Prompt management core
- Seed initial system and user prompts from HFRE-Signal-scan V4 Agents.json.
- Enforce one active prompt per type guard.

5) LLM agent service (LangChain and LangGraph aligned)
- Implement scanAgent service:
  - Use initChatModel to configure model parameters.
  - Build agent with createAgent.
  - Provide Zod responseFormat for strict JSON output.
  - Optionally wire MemorySaver from @langchain/langgraph if short-term memory is needed.
- Interpolate user prompt with form inputs.
- Invoke agent and validate structured response.
- Persist raw output if invalid for admin-only debugging.

6) Public scan submission endpoint
- POST /api/public/scans
  - Validate input.
  - Create submission with status pending and publicId.
  - Capture analytics (IP, UA).
  - Trigger async LLM execution.
  - Return { publicId }.

7) LLM execution workflow
- Load active system and user prompts from DB.
- Run agent, parse strict JSON, update submission:
  - complete on success
  - failed on schema error or runtime error

8) Email dispatch
- On completion, send:
  - Customer email with customer_report only.
  - Internal notification with full details and optional internal_report.
- Persist email timestamps and lastError.

9) Public results endpoint
- GET /api/public/results/:publicId
  - 202 pending
  - 200 complete with public-safe output
  - 500 failed with generic status

10) Admin auth
- POST /api/admin/auth/login
  - Allowlist check + bcrypt hash check
  - Issue httpOnly cookie session
- POST /api/admin/auth/logout
- Add rate limit and audit logs.

11) Admin APIs
- Submissions: list, detail, delete
- Prompts: list, create, update, delete (guard on active prompt)
- Analytics: aggregate, per-submission
- User deletion by email

12) Operational hardening
- Rate limit public and admin login endpoints.
- Sanitize output for email and public display.
- Add /health endpoint.

13) Testing and validation
- Unit tests for schemas and prompt interpolation.
- Integration tests for submission lifecycle.
- Mock LLM response to validate schema handling.
