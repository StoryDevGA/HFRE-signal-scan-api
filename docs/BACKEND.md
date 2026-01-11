# BACKEND.md — HFRE Signal Scan (Free Taster)

## 1. Purpose

Implement a Node/Express backend that:
1) Accepts form submissions (Company Signal Scan).  
2) Runs the “Signal Scan Agent” (LLM call) to produce a strict JSON output.  
3) Stores inputs, outputs, and telemetry in MongoDB.  
4) Emails the customer a copy and notifies business owners.  
5) Provides a restricted Admin API (max 3 admins) for dashboard operations.

The agent workflow to mirror is **Start (form) → Signal Scan LLM Agent → JSON output**, as defined by the AgentFlow JSON. fileciteturn4file4

---

## 2. Tech Stack

- Node.js + Express
- MongoDB (Mongoose)
- Email provider: Resend / SendGrid / Nodemailer (select one)
- LLM provider: OpenAI or other (LLM-agnostic interface recommended)
- Security:
  - Helmet
  - CORS allowlist
  - Rate limiting (public endpoints)
  - Input validation (Zod/Joi)

---

## 3. Agent Output Contract (Strict)

The LLM must return **one JSON object** with this shape (do not output anything else): fileciteturn4file14

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
- Validate the returned JSON strictly (schema validation).
- If invalid, mark submission as `failed` and persist the raw response for debugging (admin-only).
- Ensure `customer_report` is safe for public display and email (per prompt constraints).

---

## 4. Data Model (MongoDB)

### 4.1 Collections

#### `submissions`
Stores the public scan requests and results.

Fields:
- `publicId` (string, unique, unguessable; e.g., nanoid(16-24))
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
- `promptRefs`:
  - `systemPromptId`
  - `userPromptId`
  - `systemPromptVersion` (optional)
  - `userPromptVersion` (optional)
- `emailStatus`:
  - `customerSentAt`
  - `ownerSentAt`
  - `lastError`
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
- `name` (string)
- `content` (string)
- `active` (boolean)
- `version` (integer) optional
- `createdAt`, `updatedAt`

Constraint (recommended):
- Only one active prompt per type at any time.

#### `analytics`
Stores telemetry per submission.

Fields:
- `submissionId` (ObjectId ref)
- `ipAddress` (string)
- `userAgent` (string)
- `acceptLanguage` (string optional)
- `referrer` (string optional)
- `deviceSummary` (string optional derived)
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

---

## 5. Admin Authentication (Hard Constraint)

Requirement:
- Admin access granted to **max 3 admin users** by unique email address.
- Password is fixed and hard-coded in configuration, stored encrypted/hashed.

Implementation approach:
- ENV:
  - `ADMIN_EMAILS` = comma-separated list of up to 3 emails
  - `ADMIN_PASSWORD_HASH` = bcrypt hash of the fixed password
- Login endpoint checks:
  1) email is in allowlist
  2) password matches bcrypt hash
- On success:
  - issue httpOnly cookie session (recommended) OR JWT in httpOnly cookie
- No admin self-service registration.

Security notes:
- Add rate limit on login endpoint.
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
   - Load active system + user prompt from `prompts`
   - Interpolate form inputs into the user message template
   - Invoke LLM
4) Validate LLM output JSON:
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
- `404` not found
- `500` failed: `{ status: "failed" }` (do not leak internal details)

### 8.2 Admin Auth API

#### `POST /api/admin/auth/login`
Body: `{ email, password }`  
Response: `{ ok: true }`  
Sets httpOnly cookie.

#### `POST /api/admin/auth/logout`
Clears cookie.

### 8.3 Admin Submissions API

#### `GET /api/admin/submissions`
Query:
- `q` (search: email/company)
- `status`
- `page`, `pageSize`
Response: list + pagination metadata.

#### `GET /api/admin/submissions/:id`
Returns full submission:
- inputs
- outputs (including internal_report)
- metadata
- email status
- analytics (joined or separate call)

#### `DELETE /api/admin/submissions/:id`
Deletes submission and associated analytics.

### 8.4 Admin Prompts API

#### `GET /api/admin/prompts`
Returns all prompts with active state.

#### `POST /api/admin/prompts`
Creates a new prompt.

#### `PUT /api/admin/prompts/:id`
Edits prompt fields.

#### `DELETE /api/admin/prompts/:id`
Deletes prompt (block deleting currently-active prompt unless switching first).

### 8.5 Admin User Data Deletion

#### `DELETE /api/admin/users/:email`
Deletes:
- submissions where `inputs.email` matches
- associated analytics
Returns `{ deletedSubmissions: n }`

### 8.6 Admin Analytics

#### `GET /api/admin/analytics`
Aggregates:
- counts by day
- top browsers/devices (basic UA parsing)
- conversion rate (pending/complete/failed)

#### `GET /api/admin/analytics/:submissionId`
Returns telemetry record for that submission.

---

## 9. Prompt Assembly (Server-Side)

System + user message strategy:
- System message: “You are …” plus global constraints.
- User message: embed the form inputs and strict output instructions.

The provided AgentFlow example includes:
- Form input injection tokens (e.g., `{{ $form.company_name }}` etc.)
- Strict output JSON format + content rules (internal vs customer layers). fileciteturn4file14

Backend must implement equivalent prompt interpolation using the stored active prompts plus current form inputs.

---

## 10. Observability and Ops

Minimum:
- Structured logging per request (`requestId`, route, status)
- Capture LLM latency and token usage (if available)
- Store “failed” model raw output for admin debugging only
- Health endpoint: `GET /health`

---

## 11. Security and Privacy

- CORS allowlist for your frontend domain(s)
- Rate limit:
  - `POST /api/public/scans` (e.g., per IP)
  - `POST /api/admin/auth/login`
- Do not expose internal_report outside admin endpoints
- Sanitize output before email/send (avoid HTML injection)
- Data retention:
  - define retention policy for submissions/analytics (e.g., 90 days) (optional for v1)

---

## 12. Acceptance Checklist (Backend)

- Public scan submission persists inputs + analytics.
- Active prompts are loaded from MongoDB and applied.
- LLM output is validated against strict JSON schema. fileciteturn4file14
- Customer-safe results available via publicId without leaking internal_report.
- Emails send on successful completion; statuses persisted.
- Admin auth restricted to allowlist (max 3 emails) and fixed hashed password.
- Admin endpoints support: view outcomes, prompt CRUD, delete user data, view analytics.
