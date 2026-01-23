# BACKEND.md - HFRE Signal Scan (Free Taster)

## 1. Purpose

Implement a Node/Express backend that:
1) Accepts form submissions (Company Signal Scan).  
2) Runs the Signal Scan Agent (LLM call) to produce a strict JSON output.  
3) Stores inputs, outputs, and telemetry in MongoDB.  
4) Emails the customer a copy and notifies business owners.  
5) Provides a restricted Admin API (max 3 admins) for dashboard operations.

The agent workflow is implemented as a LangGraph state machine: **validate input -> invoke LLM -> parse output -> validate schema -> handle error/complete**.

---

## 2. Tech Stack

- Node.js + Express
- MongoDB (Mongoose)
- Email provider: Resend (current)
- LLM orchestration: LangGraph StateGraph + LangChain ChatOpenAI (@langchain/openai)
- Security:
  - Helmet
  - CORS (origin echo + credentials)
  - Rate limiting (admin login)
  - Input validation (Zod)
  - Session cookie auth (in-memory)

## 2.1 Environment Variables

Required:
- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_TO_OWNERS`
- `ADMIN_EMAILS` (comma-separated, max 3)
- `ADMIN_PASSWORD_HASH` (bcrypt hash)

LLM configuration:
- `LLM_MODEL_SMALL` (default: `gpt-4o-mini`)
- `LLM_MODEL_LARGE` (default: `gpt-4o`)
- `LLM_LARGE_THRESHOLD` (character count; default: `6000`)
- `LLM_MODEL` (fallback for small model if `LLM_MODEL_SMALL` is unset)
- `LLM_TEMPERATURE` (default: `0.2`)
- `LLM_MAX_TOKENS` (optional; 0 disables maxTokens)
- `LLM_RESPONSE_FORMAT` (`json` or `json_object` to enable strict JSON mode)
- `LLM_TIMEOUT_MS` (default: `60000`)

Other:
- `PENDING_RETRY_MS` (default: `60000`)
- `NODE_ENV` (`production` enables secure cookies)

---

## 3. Agent Output Contract (Strict)

The LLM must return **one JSON object** with this shape (do not output anything else): 

```json
{
  "company": "string",
  "internal_report": "string",
  "customer_report": "string",
  "metadata": {
    "confidence_level": "High | Medium | Low",
    "source_scope": "Public website only",
    "shareability": {
      "customer_safe": true,
      "internal_only": true
    }
  }
}
```

Backend responsibilities:
- Validate the returned JSON strictly (schema validation inside the agent graph).
- If invalid, mark submission as `failed` and persist the raw response for debugging (admin-only).
- Ensure `customer_report` is safe for public display and email (per prompt constraints).
- Model output may arrive as a string; parse JSON before validation (supports fenced JSON and bracketed extraction).

---

## 4. Data Model (MongoDB)

### 4.1 Collections

#### `submissions`
Stores the public scan requests and results.

Fields:
- `publicId` (string, unique, unguessable; 24-char hex from 12 random bytes)
- `status` (`pending | complete | failed`)
- `inputs`:  
  - `name`
  - `email`
  - `company_name`
  - `homepage_url`
  - `product_name`
  - `product_page_url`
- `outputs` (nullable until complete):
  - `company`
  - `internal_report` (admin-only exposure)
  - `customer_report` (public exposure allowed)
  - `metadata`
- `usage` (token usage or provider metadata; mixed shape)
- `promptRefs`:
  - `systemPromptId`
  - `userPromptId`
  - `systemPromptVersion` (optional)
  - `userPromptVersion` (optional)
- `emailStatus`:
  - `customerSentAt`
  - `ownerSentAt`
  - `lastError`
- `failure`:
  - `message`
  - `rawOutput` (optional)
- `processing`:
  - `startedAt`
  - `completedAt`
  - `llmDurationMs`
  - `llmModel`
  - `llmTemperature`
  - `totalDurationMs`
- `retry`:
  - `retriedAt`
  - `retryCount`
- `createdAt`, `updatedAt`

Indexes:
- `publicId` unique
- `inputs.email` for admin searching
- `createdAt` for listing

#### `prompts`
Stores editable prompts for system and user roles.

Fields:
- `_id`
- `type`: `system | user`
- `ownerEmail` (string)
- `label` (string; admin-provided)
- `name` (string; derived `label | ownerEmail | timestamp`)
- `content` (string)
- `isActive` (boolean; published flag)
- `publishedAt` (date)
- `publishedBy` (string)
- `isLocked` (boolean; prevents edits/deletes)
- `lockNote` (string; optional UI note)
- `version` (number; starts at 0.0 and increments by 0.5 when content changes)
- `createdAt`, `updatedAt`

Constraints:
- Max **4 prompts per admin per type** (4 system + 4 user per admin).
- Only **one published prompt per type** at a time (global).
- Any admin can publish any prompt; only owners can edit/delete their prompts.
- Locked prompts cannot be edited or deleted (publishing is still allowed).

#### `analytics`
Stores telemetry per submission.

Fields:
- `submissionId` (ObjectId ref)
- `ipAddress` (string)
- `userAgent` (string)
- `acceptLanguage` (string optional)
- `referrer` (string optional)
- `deviceSummary` (string optional derived)
- `client` (optional geo metadata):
  - `country`
  - `region`
  - `city`
  - `timezone`
  - `ipAnonymized`
- `createdAt`

Indexes:
- `submissionId`
- `createdAt`

#### `adminAudit` (optional, recommended)
Track admin operations.

Fields:
- `adminEmail`
- `action` (string)
- `target` (string)
- `metadata` (object)
- `createdAt`

Common actions:
- `prompt.create`, `prompt.update`, `prompt.delete`, `prompt.publish`

---

## 5. Admin Authentication (Hard Constraint)

Requirement:
- Admin access granted to **max 3 admin users** by unique email address.
- Password is fixed and hard-coded in configuration, stored encrypted/hashed.

Implementation approach:
- ENV:
  - `ADMIN_EMAILS` = comma-separated list of up to 3 emails
  - `ADMIN_PASSWORD_HASH` = bcrypt hash of the fixed password (bcryptjs)
  - Generate hash:
    - `node -e "console.log(require('bcryptjs').hashSync('YourPassword123', 10))"`
- Login endpoint checks:
  1) email is in allowlist
  2) password matches bcrypt hash
- On success:
  - issue httpOnly cookie session (in-memory store)
- No admin self-service registration.

Security notes:
- Login rate limit: 5 attempts per 15 minutes per IP.
- Log admin authentication attempts in `adminAudit` (optional).

---

## 6. Public Workflow (End-to-End)

### 6.1 Submit scan (public)
1) Client POSTs form payload.
2) Backend:
   - Validates payload
   - Creates `submission` with `status=pending` + `publicId`
   - Captures analytics (IP/UA etc.) into `analytics`
3) Backend executes LLM call:
   - Load published system + user prompt from `prompts`
   - Interpolate form inputs into the user message template
   - Invoke the LangGraph scan agent (validate input -> invoke -> parse -> validate -> handle error)
   - Model selection is dynamic (small vs large) based on input size threshold
4) Validate LLM output JSON (inside the agent graph):
   - If valid:
     - Persist to `submission.outputs`
     - Set `status=complete`
     - Send emails (customer + owners)
   - If invalid / error:
     - Set `status=failed`
     - Save error and (admin-only) raw model output
5) Respond to client:
   - Minimal: `{ publicId }` immediately, while processing async (preferred), OR
   - Block until complete (simpler but slower)

Recommended for UX:
- Return `{ publicId }` immediately, and frontend polls `GET /api/public/results/:publicId` until complete.
If a submission stays pending past `PENDING_RETRY_MS` (default 60000), the results endpoint will trigger a retry.

---

## 7. Email Requirements

On completion:
- Send customer email to `inputs.email` containing customer_report.
- Send notification email to business owners (one or more fixed recipients) containing:
  - contact name/email
  - company name + URLs
  - confidence level
  - customer_report
  - internal_report (optional for owners; treat as internal)

Persist:
- `emailStatus.customerSentAt`
- `emailStatus.ownerSentAt`
- `emailStatus.lastError` (if any)
Email failures do not change submission status; they are recorded in `emailStatus.lastError`.
Provider config (current):
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_TO_OWNERS` (comma-separated)

---

## 8. API Specification

### 8.1 Public API

#### `POST /api/public/scans`
Body: form payload  
Response: `{ "publicId": "string" }`

Validations:
- email format
- URLs must be valid http(s)
- Strings length limits (e.g., 2..256)

#### `GET /api/public/results/:publicId`
Response variants:
- `200` complete: returns public result model (no internal_report)
- `202` pending: `{ status: "pending" }`
- `404` not found: `{ status: "not_found" }`
- `500` failed: `{ status: "failed", message: "string" }` (message may be empty)

### 8.2 Admin Auth API

#### `POST /api/admin/auth/login`
Body: `{ email, password }`  
Response: `{ ok: true }`  
Sets httpOnly cookie.
Validation errors:
- `400` `{ errors: [ { path, message } ] }`

#### `POST /api/admin/auth/logout`
Clears cookie.
#### `GET /api/admin/auth/logout`
Clears cookie.
#### `GET /api/admin/auth/me`
Returns the current admin identity.

### 8.3 Admin Submissions API

#### `GET /api/admin/submissions`
Query:
- `q` (search: email/company)
- `status`
- `page`, `pageSize`
Response: list + pagination metadata.
Each item includes `failureMessage`, `llmModelUsed`, and `llmTemperatureUsed` (admin-only).

#### `GET /api/admin/submissions/:id`
Returns full submission:
- inputs
- outputs (including internal_report)
- metadata
- email status
- analytics (joined in response)
Response also includes `failureMessage`, `llmModelUsed`, and `llmTemperatureUsed`.

#### `DELETE /api/admin/submissions/:id`
Deletes submission and associated analytics.

### 8.4 Admin Prompts API

#### `GET /api/admin/prompts`
Returns all prompts with published state and ownership.

#### `POST /api/admin/prompts`
Creates a new prompt owned by the authenticated admin.
Limits: max 4 prompts per admin per type; returns 409 if limit exceeded.
Prompt content validation rejects example JSON where `company`, `internal_report`, or `customer_report`
are filled with literal values (must use placeholders like `"string"`).

#### `PUT /api/admin/prompts/:id`
Edits prompt fields (owner only) and/or publishes the prompt (any admin).
If `content` changes, the backend increments the prompt `version` by **0.5** (starting from **0.0**).
Publishing sets `isActive=true` (API uses `isPublished` as alias). Unpublish is not supported; publish another prompt instead.
Locked prompts cannot be edited (publish-only).

#### `DELETE /api/admin/prompts/:id`
Deletes prompt (owner only; cannot delete the last published prompt of that type).

### 8.5 Admin User Data Deletion

#### `DELETE /api/admin/users/:email`
Deletes:
- submissions where `inputs.email` matches
- associated analytics
Returns `{ deletedSubmissions: n }`
Validation error:
- `400` `{ "error": "Email is required." }`

### 8.6 Admin Analytics

#### `GET /api/admin/analytics`
Aggregates:
- counts by day
- top browsers/devices (basic UA parsing)
- conversion rate (pending/complete/failed)

#### `GET /api/admin/analytics/:submissionId`
Returns telemetry record for that submission.

---

## 8.7 Frontend Contract (Use This)

### Base URL
- Local dev: `http://localhost:8000`
- All endpoints are under `/api`.

### CORS and Cookies
- CORS echoes the request origin and allows credentials.
- Admin auth uses an httpOnly cookie named `admin_session`.
- When calling admin endpoints from the browser, send credentials.

### Public: Submit Scan
Request:
```
POST /api/public/scans
Content-Type: application/json
{
  "name": "string",
  "email": "string",
  "company_name": "string",
  "homepage_url": "string",
  "product_name": "string",
  "product_page_url": "string"
}
```
Response:
```
201
{
  "publicId": "string"
}
```
Validation errors:
```
400
{
  "errors": [
    { "path": "email", "message": "string" }
  ]
}
```

### Public: Poll Result
Request:
```
GET /api/public/results/:publicId
```
Responses:
```
202
{ "status": "pending" }
```
```
200
{
  "status": "complete",
  "publicId": "string",
  "company": "string",
  "customer_report": "string",
  "metadata": {
    "confidence_level": "High|Medium|Low",
    "source_scope": "Public website only",
    "shareability": {
      "customer_safe": true,
      "internal_only": true
    }
  }
}
```
```
404
{ "status": "not_found" }
```
```
500
{ "status": "failed", "message": "string" }
```

### Admin: Login
Request:
```
POST /api/admin/auth/login
Content-Type: application/json
{
  "email": "string",
  "password": "string"
}
```
Response:
```
200
{ "ok": true }
```
Error:
```
401
{ "error": "Invalid credentials." }
```
Validation error:
```
400
{ "errors": [ { "path": "email", "message": "string" } ] }
```

### Admin: Logout
Request:
```
POST /api/admin/auth/logout
```
Response:
```
200
{ "ok": true }
```

### Admin: Current Admin
Request:
```
GET /api/admin/auth/me
```
Response:
```
200
{ "email": "admin@example.com" }
```
Error:
```
401
{ "error": "Unauthorized." }
```

### Admin: List Submissions
Request:
```
GET /api/admin/submissions?q=string&status=pending|complete|failed&page=1&pageSize=20
```
Response:
```
200
{
  "items": [
    {
      "...submissionFields": true,
      "failureMessage": "",
      "llmModelUsed": "",
      "llmTemperatureUsed": 0
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0
}
```

### Admin: Submission Detail
Request:
```
GET /api/admin/submissions/:id
```
Response:
```
200
{
  "submission": { "publicId": "string", "inputs": {}, "outputs": {}, "emailStatus": {}, "promptRefs": {} },
  "analytics": { "submissionId": "string", "ipAddress": "string", "userAgent": "string" },
  "failureMessage": "",
  "llmModelUsed": "",
  "llmTemperatureUsed": 0
}
```

### Admin: Delete Submission
Request:
```
DELETE /api/admin/submissions/:id
```
Response:
```
200
{ "ok": true }
```

### Admin: Prompts
List:
```
GET /api/admin/prompts
```
Create:
```
POST /api/admin/prompts
Content-Type: application/json
{
  "type": "system|user",
  "label": "string",
  "content": "string",
  "isPublished": true
}
```
Note: `name` is accepted as a legacy alias for `label`, but new clients should send `label`.
Update:
```
PUT /api/admin/prompts/:id
Content-Type: application/json
{ "label": "string", "content": "string", "isPublished": true }
```
Delete:
```
DELETE /api/admin/prompts/:id
```
Delete error:
```
400
{ "error": "Cannot delete the last active system prompt. Please activate another prompt first." }
```

### Admin: Analytics
Summary:
```
GET /api/admin/analytics
```
Response:
```
200
{
  "totals": {
    "total": 0,
    "pending": 0,
    "complete": 0,
    "failed": 0,
    "conversionRate": 0,
    "completeRate": 0,
    "failedRate": 0
  },
  "countsByDay": [ { "date": "YYYY-MM-DD", "total": 0, "pending": 0, "complete": 0, "failed": 0 } ],
  "latencyMs": { "p50": 0, "p90": 0, "p95": 0, "max": 0 },
  "latencyByDay": [ { "date": "YYYY-MM-DD", "p50": 0, "p90": 0 } ],
  "failures": {
    "topFailures": [ { "message": "string", "count": 0 } ],
    "failureRate": 0,
    "failureByPromptVersion": [
      { "systemPromptVersion": 1, "userPromptVersion": 1, "count": 0 }
    ]
  },
  "promptPerformance": {
    "byPair": [
      { "systemPromptVersion": 1, "userPromptVersion": 1, "completeRate": 0, "avgDurationMs": 0 }
    ],
    "bySystemVersion": [ { "version": 1, "completeRate": 0, "avgDurationMs": 0 } ],
    "byUserVersion": [ { "version": 1, "completeRate": 0, "avgDurationMs": 0 } ]
  },
  "retries": {
    "totalRetries": 0,
    "retriesPerDay": [ { "date": "YYYY-MM-DD", "retries": 0 } ],
    "retrySuccessRate": 0
  },
  "topBrowsers": [ { "key": "Chrome", "count": 0 } ],
  "topDevices": [ { "key": "Desktop", "count": 0 } ],
  "topReferrers": [ { "key": "Direct", "count": 0 } ],
  "topCountries": [ { "key": "US", "count": 0 } ],
  "usage": {
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "submissionsWithUsage": 0,
    "averagePromptTokens": 0,
    "averageCompletionTokens": 0,
    "averageTotalTokens": 0,
    "bySystemVersion": [ { "version": 1, "avgTotalTokens": 0 } ],
    "byUserVersion": [ { "version": 1, "avgTotalTokens": 0 } ]
  }
}
```
Per-submission:
```
GET /api/admin/analytics/:submissionId
```

### Admin: Delete User Data
Request:
```
DELETE /api/admin/users/:email
```
Response:
```
200
{ "deletedSubmissions": 0 }
```

### Error Shapes (General)
- Validation: `{ "errors": [ { "path": "string", "message": "string" } ] }`
- Server errors: `{ "error": "string" }`

---

## 8.8 React (JS) Example

```jsx
import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8000/api";

export function ScanForm() {
  const [publicId, setPublicId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);

  async function submitScan(formData) {
    setStatus("submitting");
    const res = await fetch(`${API_BASE}/public/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      setStatus("error");
      return;
    }
    const data = await res.json();
    setPublicId(data.publicId);
    setStatus("pending");
  }

  useEffect(() => {
    if (!publicId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const res = await fetch(`${API_BASE}/public/results/${publicId}`);
      const data = await res.json();
      if (cancelled) return;
      if (res.status === 200) {
        setResult(data);
        setStatus("complete");
        clearInterval(interval);
      } else if (res.status === 500) {
        setStatus("failed");
        clearInterval(interval);
      } else if (res.status === 404) {
        setStatus("not_found");
        clearInterval(interval);
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicId]);

  return (
    <div>
      <button
        onClick={() =>
          submitScan({
            name: "Test User",
            email: "test@example.com",
            company_name: "Acme Inc",
            homepage_url: "https://acme.example",
            product_name: "Widget",
            product_page_url: "https://acme.example/widget",
          })
        }
      >
        Submit
      </button>
      <div>Status: {status}</div>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
```

Admin login with cookie (use credentials):
```jsx
async function adminLogin(email, password) {
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  return res.ok;
}
```

## 9. Prompt Assembly (Server-Side)

System + user message strategy:
- System message: global constraints.
- User message: embed the form inputs and strict output instructions.

Prompt guidance:
- Form input injection tokens (e.g., `{{ $form.company_name }}` etc.)
- Strict output JSON format + content rules (internal vs customer layers)
- A JSON-only guard is appended at runtime to prevent code fences or extra text.

Backend interpolates stored prompts with current form inputs before invoking the graph.

---

## 10. Observability and Ops

Minimum:
- Structured logging per request (`requestId`, route, status)
- Capture LLM latency and token usage (if available)
- Persist LLM model and temperature used per submission (`processing.llmModel`, `processing.llmTemperature`)
- Store failed model raw output for admin debugging only
- Health endpoint: `GET /health`
Current behavior:
- Request ID added and logged as `X-Request-Id`

---

## 11. Security and Privacy

- CORS (origin echo + credentials)
- Rate limit:
  - `POST /api/admin/auth/login`
- Do not expose internal_report outside admin endpoints
- Sanitize output before email/send (avoid HTML injection)
- Data retention:
  - define retention policy for submissions/analytics (e.g., 90 days) (optional for v1)

---

## 12. Acceptance Checklist (Backend)

- Public scan submission persists inputs + analytics.
- Published prompts are loaded from MongoDB and applied.
- LLM output is validated against strict JSON schema. 
- Customer-safe results available via publicId without leaking internal_report.
- Emails send on successful completion; statuses persisted.
- LLM model and temperature used are stored per submission.
- Admin auth restricted to allowlist (max 3 emails) and fixed hashed password.
- Admin endpoints support: view outcomes, prompt CRUD, delete user data, view analytics.

## 13. Prompt Editing Checklist (Avoid “Inconclusive” Failures)

- Keep the strict JSON output block, but only use placeholders (e.g., `"company": "string"`).
- Do not include example outputs with real company names.
- Avoid instructions that require browsing or “visible evidence” unless you add retrieval.
- Ensure the user prompt injects form inputs (e.g., `{{$form.company_name}}`, `{{$form.product_name}}`).
- Do not forbid inference entirely; allow reasonable inference from provided inputs.





