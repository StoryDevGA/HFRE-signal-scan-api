# API Task List (HFRE Signal Scan)

1) Bootstrap Express app, config, and middleware (Helmet, CORS, logging, JSON limits). (done)
2) Add env vars for MongoDB, LLM provider, email provider, admin allowlist/hash.
3) Build Zod/Joi schemas for public input, admin auth, prompt CRUD, and LLM output.
4) Create Mongoose models: submissions, prompts, analytics, adminAudit with indexes.
5) Seed initial system and user prompts from HFRE-Signal-scan V4 Agents.json.
6) Implement prompt service with one-active-per-type guard.
7) Build scanAgent service with LangChain createAgent + initChatModel + Zod responseFormat.
8) Implement POST /api/public/scans with validation, analytics capture, pending submission, async scan.
9) Implement LLM execution worker/service and update submission status on completion or failure.
10) Implement email sender for customer and internal notifications with status persistence.
11) Implement GET /api/public/results/:publicId with pending/complete/failed responses.
12) Implement admin auth endpoints with allowlist, bcrypt hash, session cookie, rate limit.
13) Implement admin submissions endpoints (list, detail, delete).
14) Implement admin prompts endpoints (list, create, update, delete guard).
15) Implement admin analytics endpoints (aggregate + per-submission).
16) Implement admin user deletion by email endpoint.
17) Add /health endpoint and structured logging with requestId.
18) Add tests for validation, prompt interpolation, and submission lifecycle.
