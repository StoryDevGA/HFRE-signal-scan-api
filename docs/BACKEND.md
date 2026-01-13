# BACKEND.md - HFRE Signal Scan (Free Taster)

## 1. Purpose

Implement a Node/Express backend that:
1) Accepts form submissions (Company Signal Scan).  
2) Runs the Signal Scan Agent (LLM call) to produce a strict JSON output.  
3) Stores inputs, outputs, and telemetry in MongoDB.  
4) Emails the customer a copy and notifies business owners.  
5) Provides a restricted Admin API (max 3 admins) for dashboard operations.

The agent workflow to mirror is **Start (form) -> Signal Scan LLM Agent -> JSON output**, as defined by the AgentFlow JSON. 

---

## 2. Tech Stack

- Node.js + Express
- MongoDB (Mongoose)
- Email provider: Resend (current)
- LLM provider: LangChain initChatModel (LLM-agnostic)
- Security:
  - Helmet
  - CORS (origin echo + credentials)
  - Rate limiting (admin login)
  - Input validation (Zod)
  - Session cookie auth (in-memory)

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
- Validate the returned JSON strictly (schema validation).
- If invalid, mark submission as `failed` and persist the raw response for debugging (admin-only).
- Ensure `customer_report` is safe for public display and email (per prompt constraints).
- Model output may arrive as a string; parse JSON before validation.

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
- `failure`:
  - `message`
  - `rawOutput` (optional)

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
- `500` failed: `{ status: "failed" }` (do not leak internal details)

### 8.2 Admin Auth API

#### `POST /api/admin/auth/login`
Body: `{ email, password }`  
Response: `{ ok: true }`  
Sets httpOnly cookie.

#### `POST /api/admin/auth/logout`
Clears cookie.
#### `GET /api/admin/auth/logout`
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
- analytics (joined in response)

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
Deletes prompt (block deleting currently-active prompt).

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
{ "status": "failed" }
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

### Admin: List Submissions
Request:
```
GET /api/admin/submissions?q=string&status=pending|complete|failed&page=1&pageSize=20
```
Response:
```
200
{
  "items": [ "submission" ],
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
  "analytics": { "submissionId": "string", "ipAddress": "string", "userAgent": "string" }
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
  "name": "string",
  "content": "string",
  "active": true,
  "version": 1
}
```
Update:
```
PUT /api/admin/prompts/:id
Content-Type: application/json
{ "name": "string", "content": "string", "active": true, "version": 2 }
```
Delete:
```
DELETE /api/admin/prompts/:id
```
Delete error:
```
400
{ "error": "Disable active prompt before deleting." }
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
  "totals": { "total": 0, "pending": 0, "complete": 0, "failed": 0, "conversionRate": 0 },
  "countsByDay": [ { "date": "YYYY-MM-DD", "count": 0 } ],
  "topBrowsers": [ { "key": "Chrome", "count": 0 } ],
  "topDevices": [ { "key": "Desktop", "count": 0 } ]
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

The provided AgentFlow example includes:
- Form input injection tokens (e.g., `{{ $form.company_name }}` etc.)
- Strict output JSON format + content rules (internal vs customer layers). 

Backend must implement equivalent prompt interpolation using the stored active prompts plus current form inputs.

---

## 10. Observability and Ops

Minimum:
- Structured logging per request (`requestId`, route, status)
- Capture LLM latency and token usage (if available)
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
- Active prompts are loaded from MongoDB and applied.
- LLM output is validated against strict JSON schema. 
- Customer-safe results available via publicId without leaking internal_report.
- Emails send on successful completion; statuses persisted.
- Admin auth restricted to allowlist (max 3 emails) and fixed hashed password.
- Admin endpoints support: view outcomes, prompt CRUD, delete user data, view analytics.





