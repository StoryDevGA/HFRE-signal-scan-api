# Analytics Spec

Purpose
- Extend analytics beyond totals to include funnel, failures, latency, prompt performance, token usage, email delivery, retries, and traffic sources.
- Keep metrics derived from existing `Submission` and `Analytics` data, with minimal new fields.

Scope
- Backend-only spec for data capture and API response shape.
- UI not included.

Data Sources (existing)
- Submission: status, createdAt, updatedAt, outputs, promptRefs, emailStatus, failure, usage.
- Analytics: submissionId, ipAddress, userAgent, acceptLanguage, referrer, createdAt.

New Fields (proposed)
- Submission.processing
  - startedAt: Date
  - completedAt: Date
  - llmDurationMs: Number
  - totalDurationMs: Number
- Submission.retry
  - retriedAt: Date
  - retryCount: Number
- Analytics.client
  - country: String
  - region: String
  - city: String
  - timezone: String
  - ipAnonymized: String (optional; store truncated IP)

Metrics

1) Conversion Funnel (DONE)
- Definition: % of submissions by status over a time window.
- Source: Submission.status + createdAt.
- Output:
  - totals: total, pending, complete, failed
  - rates: completeRate, failedRate
  - countsByDay: [{ date, total, pending, complete, failed }]

2) Time-to-Complete (DONE)
- Definition: latency from submission creation to completion (or failure).
- Source: Submission.createdAt, Submission.processing.completedAt.
- Output:
  - latencyMs: p50, p90, p95, max
  - perDay: [{ date, p50, p90 }]

3) Failure Analytics (DONE)
- Definition: most common failure messages and failure rate.
- Source: Submission.failure.message, Submission.status.
- Output:
  - topFailures: [{ message, count }]
  - failureRate: failed / total
  - failureByPromptVersion: [{ systemPromptVersion, userPromptVersion, count }]

4) Prompt Performance (DONE)
- Definition: completion rate and latency by prompt version.
- Source: Submission.promptRefs, Submission.status, Submission.processing.totalDurationMs.
- Output:
  - bySystemVersion: [{ version, completeRate, avgDurationMs }]
  - byUserVersion: [{ version, completeRate, avgDurationMs }]
  - byPair: [{ systemVersion, userVersion, completeRate, avgDurationMs }]

5) Token Usage (DONE)
- Definition: total tokens and averages by prompt version and overall.
- Source: Submission.usage.
- Output:
  - overall: avgInput, avgOutput, avgTotal
  - bySystemVersion: [{ version, avgTotal, avgInput, avgOutput }]
  - byUserVersion: [{ version, avgTotal, avgInput, avgOutput }]

6) Email Delivery
- Definition: delivery success rate and timing for customer/owner emails.
- Source: Submission.emailStatus.
- Output:
  - customer: sentRate, avgDelayMs, lastErrorRate
  - owner: sentRate, avgDelayMs, lastErrorRate

7) Retry Behavior (DONE)
- Definition: number of retries for pending submissions and their outcomes.
- Source: Submission.retry.
- Output:
  - totalRetries
  - retriesPerDay: [{ date, retries }]
  - retrySuccessRate

8) Traffic Sources & Client Stats (DONE)
- Definition: referrer, browser, device, geo breakdowns.
- Source: Analytics.referrer, Analytics.userAgent, Analytics.client.
- Output:
  - topReferrers: [{ key, count }]
  - topBrowsers: [{ key, count }]
  - topDevices: [{ key, count }]
  - topCountries: [{ key, count }]

API Proposal (admin)
- GET /admin/analytics/overview
  - totals, rates, countsByDay, latencyMs
- GET /admin/analytics/failures
  - topFailures, failureRate, failureByPromptVersion
- GET /admin/analytics/prompts
  - bySystemVersion, byUserVersion, byPair
- GET /admin/analytics/usage
  - overall, bySystemVersion, byUserVersion
- GET /admin/analytics/email
  - customer, owner
- GET /admin/analytics/retries
  - totalRetries, retriesPerDay, retrySuccessRate
- GET /admin/analytics/traffic
  - topReferrers, topBrowsers, topDevices, topCountries

Implementation Notes
- Capture processing timestamps in scan flow:
  - set `processing.startedAt` when submission begins
  - set `processing.completedAt` on completion/failure
  - derive durations
- Normalize token usage into a consistent shape before storing.
- Consider anonymizing IPs for privacy; store `ipAnonymized`.
- Add indexes for `createdAt`, `status`, and `promptRefs.systemPromptVersion/userPromptVersion`.
