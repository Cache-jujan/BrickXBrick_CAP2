# BrickXBrick F3 & F5 QA Audit Report

Oct 8, 2026 · @Jad

## A. Executive summary

**Verdict: F3 and F5 are demonstrable on the happy path, but not defense-ready as-is.** Of 132 executed checks, 86 passed, 34 failed and 12 were observations with no documented rule to test against. The progress math is correct; the schedule-variance alerting, Site Manager reassignment, and cross-project read access are not.

**What works, with execution evidence**

- Milestone and task creation with ownership checks, auto-assignment to the project's Site Manager, and persistence across sessions.
- The full SM-submits → PM-acknowledges/flags lifecycle, including supersede-on-resubmit, completed-task lock, and offline-replay idempotency for the same task.
- Milestone % is the arithmetic mean of task % (pending and flagged submissions correctly excluded). Project % is the unweighted mean of milestone %, exactly as the manuscript specifies, and the web UI shows the same figure.
- The 10 MB limit is enforced server-side at the exact byte boundary (10,485,760 accepted; 10,485,761 rejected).

**Most serious confirmed defects**

1. **D-01 (High)** — Schedule variance is never detected by the passage of time. A milestone that goes past due with no task activity stays "On Track" and no alert is sent. Status is only recalculated on task creation or PM acknowledgement.
2. **D-02 (High)** — Changing a project's Site Manager does not move its existing tasks. The old SM keeps seeing and submitting them; the new SM gets 403.
3. **D-03 (High)** — Any logged-in user (another PM, another SM, the Purchaser) can read any project's milestones and tasks, including evidence photo URLs.
4. **D-06 (Medium)** — Concurrent Acknowledge + Flag both returned 200, leaving the log "Flagged" while the task is "Completed".
5. **D-07 (Medium)** — Photo type is checked only from the client-declared MIME type: a text file, an HTML file, a 0-byte file and a corrupt JPEG were all accepted as evidence.

**Major demo risks**

- A panelist asks "what happens when a milestone slips and nobody updates it?" — the answer today is nothing (D-01).
- A just-created milestone with a past due date displays "On Track" on the PM's project page (screenshot evidence, W-03).
- A Site Manager who gets flagged has no way to see that they were flagged or why (D-04).
- F5.3 (issue report) cannot be demonstrated independently: it is an F4 "Report" ticket with no link to a task.

**Executed vs. inspected.** All API results come from real HTTP calls against the unmodified backend on an isolated Postgres 16 database with all 19 migrations applied. Nine checks drove the real web UI in a headless browser. Two pieces were test-only stand-ins: a local JWT issuer (so the real auth middleware ran), and a local stub replacing Cloudflare R2 storage (no credentials). The Expo mobile app was not run; its screens are static review only. Supabase login and real R2 delivery were not exercised.

## B. Requirements traceability matrix

Every requirement except F5.3 has runtime evidence; F5.3 is blocked on F4 and F5.6 is excluded. Check IDs refer to section E. Paths are relative to the repo root on `develop` at commit 6b7e605.

| Req | Expected behavior | Implementation | DB objects | Auth | Tests run | Status | Defects |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F3.1 | PM creates milestone with target due date | `backend/src/routes/milestones.js` POST `/` + `getOwnedProject`; `frontend/src/pages/Milestones/CreateMilestonePage.jsx` | `milestones` (dueDate DATE NOT NULL) | PM, must own project | M-01…M-23, W-02 | PASS, with defects | D-03, D-09, D-11, D-12 |
| F3.2 | Task under a milestone | milestones.js POST `/:id/tasks`; `CreateTaskPage.jsx` | `tasks.milestoneID` FK | PM, must own project | T-01…T-10, W-04 | PASS, with defects | D-09 |
| F3.3 | Task assigned to a Site Manager | Same route; auto-assigns `projects.siteManagerId` (no picker) | `tasks.assignedTo` | PM | T-01, T-09, R-01…R-03 | FAIL | D-02, D-16 |
| F3.4 | SM views assigned tasks | `backend/src/routes/tasks.js` GET `/assigned`; `mobile/app/site-manager.tsx`, `site-manager/task/[id].tsx` | `tasks`, `task_progress_log` | SM | V-01…V-08 | PASS (API); mobile UI static only | D-03, D-14 |
| F3.5 | Milestone % = arithmetic mean | `backend/src/lib/milestoneProgress.js` `recalcMilestoneProgress` | `milestones.completionPercentage` DECIMAL(5,2) | Internal | C-01…C-07 | PASS | — |
| F3.6 | Overall project % | `backend/src/routes/projects.js` GET `/:id`, `/:id/overview` (SQL AVG); `ProjectDetailPage.jsx` | Computed on read | GM, owning PM | G-01…G-05, W-01 | PASS | — |
| F3.7 | Schedule variance alert to PM | `milestoneProgress.js` `deriveStatus` + notification insert; `routes/notifications.js`; `Topbar.jsx` bell | `milestones.status`, `notifications` | Recipient-scoped | S-00…S-13, W-03, W-05, W-09 | FAIL | D-01, D-10 |
| F5.1 | Binary completion for PM review | tasks.js POST `/:id/progress`, GET `/progress-log`, PATCH `/progress-log/:logId/review`; `ProgressReviewPage.jsx` | `task_progress_log` | SM submits; owning PM reviews | P-01…P-26, W-06…W-08 | PASS, with defects | D-04, D-05, D-06, D-13 |
| F5.2 | JPEG/PNG photo, max 10 MB | multer `limits.fileSize` + MIME check in tasks.js; `backend/src/lib/r2.js` | `task_progress_log.photoEvidenceURL` | SM | U-02…U-13, P-26 | FAIL (type); PASS (size); storage BLOCKED | D-07 |
| F5.3 | Submit issue report | F4: `routes/tickets.js` POST `/` with `ticketType: "Report"`; `mobile/app/ticket-request.tsx` | `tickets` (no task link); `tasks.issueReport` unused | SM | None (out of scope) | BLOCKED (F4) | Design gap, see G |
| F5.4 | Auto-recalculate milestone + project % | Acknowledge branch calls `recalcMilestoneProgress`; project % computed on read | As F3.5/F3.6 | PM | P-16, C-03…C-06, G-02…G-04, W-08 | PASS | — |
| F5.5 | Variance alert after updates | Same recalc on Acknowledge only | `notifications` | Internal | S-05, S-05b, S-12, S-14 | FAIL | D-01, D-08 |
| F5.6 | Offline queue via F10 | `clientSubmissionId` contract only | `task_progress_log.clientSubmissionId` UNIQUE | — | P-06, P-19 (observations) | EXCLUDED | Concern noted in G |

## C. End-to-end workflow findings

Five of the nine workflows hold together from user action to final display; schedule variance, reassignment and issue reporting do not.

**A. Milestone creation — works, with gaps.** The web form posted through the real UI, persisted one row even when the submit button was clicked twice (W-02), and the milestone appeared on the project page. Backend ownership is enforced: another PM, a GM, an SM and the Purchaser all got 403 (M-12, M-13). Gaps: the API accepts a whitespace-only name, a past due date, a date after the project end, and an Archived project (M-05, M-08, M-09, M-17). Two concurrent API calls created two identical rows (M-16); the UI prevents this, the API does not.

**B. Task creation and assignment — works at creation, breaks on reassignment.** Tasks always go to the project's current Site Manager, and a forged `assignedTo` in the payload was ignored (T-01). A project with no SM returns a clear 400 (T-09). After the PM switched Beta's SM from SM2 to SM1, task TB stayed with SM2: SM2 still saw it and submitted (201), SM1 could not see it and got 403 (R-01). New tasks then went to SM1, so one project ended up with tasks split across two SMs (R-02). Clearing the SM left SM2 with access (R-03).

**C. Assigned-task viewing — works for the right user.** SM1 saw only SM1's tasks; SM2 never saw them; a PM calling the SM endpoint got 403 (V-02…V-04). The empty list returns `[]` (V-01). The response carries no project or milestone name (V-05), and tasks on an Archived project still appear in the active list (V-08). Mobile screens were inspected, not run: the list shows "ASSIGNED" for both untouched and under-review tasks.

**D. Completion update and PM review — works, with state-integrity holes.** Submission creates a Pending Review row and does not touch the task or milestone (P-01). Acknowledge flips the task to Completed 100%, copies the photo, records SM1 as `updatedBy` and PM1 as reviewer (P-16), and the UI button does the same (W-08). Flag requires a reason and leaves the task untouched (P-12b, P-13). Resubmission supersedes the earlier pending row (P-09). Completed tasks are locked (P-18). Failures: the SM is never told about a flag (P-13b); five concurrent submissions left two Pending rows (P-22); concurrent Acknowledge + Flag both succeeded (P-23).

**E. Photo evidence — size enforced, type not.** The server rejects one byte over 10 MiB and accepts exactly 10 MiB (U-03, U-04). A real GIF is rejected because its declared type is `image/gif` (U-06). Anything declared `image/jpeg` or `image/png` is stored regardless of content (U-07…U-10). A storage failure returns 500 and writes no log row; retry succeeds (P-26).

**F. Issue reporting — blocked.** An issue report is an F4 ticket of type "Report". Tickets have a `projectID` but no `taskID`, so the manuscript's "visible to the PM in the task detail view" cannot be met without a schema change. Not tested, per instruction.

**G. Milestone completion % — correct.** With binary tasks, 1/3 → 33.33, 2/3 → 66.67, 3/3 → 100 with status Completed and `completedAt` set (C-03). Adding a fourth task to the completed milestone dropped it to 75 and cleared `completedAt` (C-06). Zero tasks gives 0 without a division error (C-01). The stored value matched an independent SQL average (C-07).

**H. Overall project progress — correct per manuscript.** Epsilon had milestones at 50%, 75% and an empty one at 0%. The API returned 41.67, the unweighted mean; the task-weighted figure would have been 66.67 (G-03). Pending submissions do not move it (G-04), and the web page shows the same number as the database (W-01). Note that an empty milestone pulls progress down — that is what the manuscript formula says, but confirm it is intended.

**I. Schedule variance alerts — event-driven only.** When a task is added to a milestone due in 2 days, it turns At Risk and PM1 gets exactly one alert, with no duplicates on later tasks or page refreshes (S-01, S-02). A milestone completed early ends Completed with no extra alert (S-06). Alerts reach only the right PM and can only be marked read by that PM (S-13). Failures: a milestone whose due date passes with no activity stays On Track (S-05), a just-created past-due milestone shows On Track (W-03), a late task under an on-track milestone never alerts (S-12), and alert text omits the milestone name (S-09). Generation and delivery are separate: delivery (stored row → API → bell, W-09) works; generation is what fails.

## D. Defect register

Sixteen confirmed defects: 3 High, 6 Medium, 7 Low. Every one is reproduced by a check in section E; none is inferred from code alone.

| ID | Sev | Req | Location | Reproduce → expected vs. actual | Root cause | Impact | Fix | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | High | F3.7, F5.5 | `backend/src/lib/milestoneProgress.js` L26–87; callers milestones.js L128, tasks.js L247 | S-05: milestone due in 30 days with a task, due date moved to yesterday, overview loaded → expected Overdue + alert; actual On Track, 0 alerts. S-03a/W-03: past-due milestone created → shows On Track. | Status is recomputed only on task create or Acknowledge. No recalc on milestone create, none on read, no scheduler. | Core F3.7 scenario (a slipping milestone with no updates) never alerts; PM page shows stale status. | Recalc on milestone create; derive status on read in `/overview`; add a periodic sweep (same pattern as server.js tamper scan) over non-Completed milestones | Create past-due milestone → Overdue + 1 alert; time-shift test → alert once; sweep twice → still 1 |
| D-02 | High | F3.3 | `backend/src/routes/projects.js` L149–186 (PATCH `/:id/site-manager`); `tasks.assignedTo` copied at create, milestones.js L119–122 | R-01: Beta SM changed SM2 → SM1 → expected TB follows SM1; actual SM2 still sees and submits (201), SM1 gets 403. | Reassignment updates `projects.siteManagerId` only. | Wrong person can complete work; new SM locked out; split ownership inside one project. | In the same transaction, reassign open tasks (`status <> 'Completed'`) of that project's milestones. Decide what happens to their pending logs. | Reassign → new SM sees/submits, old SM 403; completed tasks keep original assignee |
| D-03 | High | F3.1, F3.4 | `backend/src/routes/milestones.js` L73–90 (GET `/`), L140–161 (GET `/:id`) | M-20a–c, V-06, V-07: PM2, SM2, Purchaser read Alpha → expected 403; actual 200 with 7 milestones / nested tasks incl. photo URLs. | Only `requireAuth`; no project-access check. | Cross-project data exposure, including evidence photo links. | Reuse an access check: GM, owning PM, or the project's SM | Each unrelated role gets 403 on both routes |
| D-04 | Medium | F5.1 | tasks.js L15–36 (`/assigned`), L249–257 (Flag); `mobile/app/site-manager/task/[id].tsx` | P-13b: flag with reason → expected SM can see flag + reason; actual 0 SM notifications and `/assigned` has no flag field. | Flag writes only the log row; `/assigned` joins only Pending Review rows. | SM does not know to resubmit; demo of the flag loop dead-ends on mobile. | Return latest review status/reason in `/assigned`; show it on mobile; optional notification (needs CHECK constraint migration) | Flag → `/assigned` shows Flagged + reason |
| D-05 | Medium | F5.1 | tasks.js L129–135 | P-20: SM1 reuses T2's clientSubmissionId on T3 → expected rejection; actual 200 with T2's row, T3 gets nothing. P-21: SM2 sends SM1's id on a Beta task → 200 returns SM1's row and photo URL. | Idempotency lookup keyed on `clientSubmissionId` alone. | Silent lost submission (F10 bug surface); another user's row returned. | Match on id + taskId + submittedBy; same id on a different task → 409 | P-20 and P-21 return 409 |
| D-06 | Medium | F5.1 | tasks.js L142–160 (submit), L207–262 (review) | P-22: 5 parallel submits → expected 1 Pending; actual 2. P-23: parallel Acknowledge + Flag → expected one 409; actual both 200, log Flagged, task Completed. | Check-then-act with no row lock or conditional update. | Contradictory states; double-click or flaky network can trigger. | `SELECT … FOR UPDATE` on the task; review via `UPDATE … WHERE reviewStatus='Pending Review' RETURNING` → 409 on 0 rows; partial unique index on pending per task | Re-run P-22, P-23 |
| D-07 | Medium | F5.2 | tasks.js L107–111 | U-07–U-10: text, HTML, 0-byte, corrupt JPEG declared as image → expected 400; actual 201, stored as .png/.jpg. | Only `req.file.mimetype` (client-supplied) is checked. | Non-photos accepted as audit evidence. | Check magic bytes (`FF D8 FF`, `89 50 4E 47`) and size > 0; optionally decode | U-07–U-10 return 400 |
| D-08 | Medium | F5.5 | milestoneProgress.js (milestone-only); `tasks.scheduleVarianceAlertSent` unused | S-12: task 3 days past its own due date under on-track milestone → expected alert (UC-05-01 postcondition 3, E3); actual 0. | Only milestone dates evaluated. Manuscript UC-03-01 says milestone-level; UC-05-01 says task-level. | Requirement conflict; panel may follow UC-05-01. | Decide the rule first, then implement using the existing flag column | Late task → 1 alert, flag set |
| D-09 | Medium | F3.1, F3.2, F5.1 | `backend/src/server.js` L47–49; no input validation in milestones.js / tasks.js | M-06, M-07, M-10, M-15, T-04, T-05, P-08, P-24, E-01 → expected 400; actual 500 with raw Postgres text, e.g. `invalid input syntax for type uuid: "abc"`. | DB errors bubble to a handler that echoes `err.message`. | 500s on bad input; schema details leak. | Validate UUID/date/length; map PG codes 22P02, 22007, 22008, 22001 to 400; generic text for 500 | All listed checks return 400 |
| D-10 | Low | F3.7 | milestoneProgress.js L75–82 | S-09/W-09: alert reads "Milestone on project … is now At Risk — due …" with no milestone name. | Message omits `m.name`. | Three alerts on one project are indistinguishable (screenshot). | Include milestone name | Message contains name |
| D-11 | Low | F3.1 | milestones.js L57, L104 | M-17/V-08: milestone and task created on an Archived project → expected 4xx (UC-03-01 precondition, E1); actual 201, task in SM's list. | No project status check. | Work on closed projects. | Require `status = 'Active'` | Archived → 409/400 |
| D-12 | Low | F3.1 | milestones.js L51 | M-05: name `"   "` → expected 400; actual 201. | No trim on the server. UI trims, so UI path is safe. | Blank-named milestones via API. | Trim and re-check | M-05 → 400 |
| D-13 | Low | F5.1 | `frontend/src/pages/Tasks/ProgressReviewPage.jsx` L90; tasks.js L174 | W-07: review card shows `Milestone: 4afefe8a-…` (a UUID), no project. | Query returns only `milestoneId`. | PM can't tell which project/milestone without lookups. | Join milestone and project names | Card shows names |
| D-14 | Low | F3.4 | tasks.js L18–29 | V-05: `/assigned` returns no project or milestone name. | Query selects only task columns. | SM with several projects can't tell tasks apart. | Join names | Fields present |
| D-15 | Low | F5.1 (F10 concern) | tasks.js L120–124 precede L129 | P-19: replay of an already-acknowledged submission → expected original row (idempotent); actual 409 "already completed". | Completed check runs before the idempotency lookup. | F10 replay may treat a successful sync as a failure. | Move idempotency lookup before the Completed check | Replay after ack → 200 same row |
| D-16 | Low | F3.3 | milestones.js L117–131 | P-13b side result: after many task assignments SM1 had 0 notifications → UC-03-01 step 5 says the system notifies the assigned SM. | No notification on assignment. | SM only finds tasks by refreshing. | Insert a notification (needs CHECK constraint migration) or record as a documented deviation | Create task → SM notification |

## E. Test execution report

132 F3/F5 checks executed: 86 PASS, 34 FAIL, 12 OBSERVED (no documented rule to judge against). Every check, with its expected and actual result, is in the **Check log** tab. The repo's own 62 backend tests pass but none of them touch F3 or F5.

| Layer | What ran | Checks | PASS | FAIL | OBSERVED |
| --- | --- | --- | --- | --- | --- |
| API + DB (integration) | `run-suite.js`, `run-supplement.js`: real HTTP to the backend, DB state asserted with SQL | 123 | 79 | 32 | 12 |
| End-to-end (web UI) | `web-e2e.mjs`: headless Chromium driving the production build of `frontend/` | 9 | 7 | 2 | 0 |
| Existing unit tests | `npm test` in `backend/` (F6–F9 libs only) | 62 | 62 | 0 | — |
| Static gates | `node --check src/server.js`; `npm run lint` + `npm run build` in `frontend/`; `npx tsc --noEmit` in `mobile/` | 4 | 4 | 0 | — |

**Environment and commands**

1. `git clone --depth 1 --branch develop` → commit 6b7e605 (merge of PR #76).
2. Postgres 16.15, fresh database `bxb_qa`; all 19 files in `infra/db/migrations/` applied in filename order with `psql -v ON_ERROR_STOP=1` — all succeeded, including the duplicate `011_*` and `015_*` prefixes.
3. Synthetic seed: GM, PM1, PM2, SM1, SM2, an inactive SM, Purchaser, SysAdmin; projects Alpha (PM1/SM1), Beta (PM2/SM2), Gamma (PM1, no SM), Delta (Archived). Epsilon was created through `POST /api/projects`.
4. Backend started with `node -r r2-stub.js src/server.js` on port 3100. No source file was edited.
5. `npm ci` in `backend/`, `frontend/`, `mobile/`.

**Test-only workarounds (labelled, nothing hidden)**

- **Auth:** a local JWKS server signs RS256 tokens with the expected issuer and audience, so `middleware/auth.js` ran unmodified, including the DB user lookup and the inactive-account check. Supabase login itself was not exercised.
- **Storage:** a preload stub replaces `lib/r2.js` with the same contract (rejects non-JPEG/PNG, returns a URL) but writes to local disk. It can simulate an outage (P-26). Real R2 upload and public URL access were not tested.
- **Time:** S-05 and S-14 move a milestone's due date with SQL to simulate days passing; this is a test technique, not an app action.

**Blocked or not run**

- F5.3 issue reporting: blocked by F4, not run.
- F5.6 offline queue: excluded; only P-06 and P-19 touch its contract.
- Expo mobile app: not run (no device or emulator). Mobile screens are static review only; `tsc` passes.
- Real R2 upload/retrieval and photo access after refresh: blocked, no credentials. Retrieval was verified only against the stub (byte sizes in U-02…U-10).
- Supabase login flow on web and mobile: not run.

**Reproduce:** `run-suite.js`, `run-supplement.js`, `web-e2e.mjs`, the harness and fixtures are attached in chat as a zip.

## F. Data integrity and security findings

Write paths are well guarded; the weak spots are read access, concurrency and input validation. Only evidence-backed items are listed.

**Confirmed issues**

- **Cross-project read exposure (D-03).** `GET /api/milestones?projectId=` and `GET /api/milestones/:id` return data to any authenticated role. Observed for another PM, another SM and the Purchaser.
- **Stale task ownership (D-02).** After SM reassignment, the previous SM keeps backend authority over the project's open tasks.
- **Inconsistent review state (D-06).** Concurrent review produced log = Flagged with task = Completed, and concurrent submits produced two Pending rows for one task.
- **Idempotency key not scoped (D-05).** Another user's progress row, including note and photo URL, is returned if their `clientSubmissionId` is sent. Exploiting it needs the other UUID, so practical risk is low; the lost-submission effect is the bigger concern.
- **Unvalidated file content (D-07).** Evidence integrity relies on the client's declared MIME type.
- **Error text leakage (D-09).** Nine inputs produced 500s whose bodies contain raw Postgres messages and column types.

**Verified as sound**

- Missing token, wrong audience and inactive account are rejected with 401/403 (AUTH-01…03).
- All create/submit/review routes enforce role and ownership on the backend, not just in the UI (M-12, M-13, T-07, T-08, P-04, P-05, P-10, P-11).
- A forged `assignedTo` in the task payload is ignored (T-01).
- Queries are parameterized; an injection-shaped name was stored literally (M-23).
- Role check runs before multer buffers the upload, and unauthenticated uploads get 401 (U-13).
- A storage failure leaves no partial log row; task updates, log updates, recalculation and alert insert share one transaction (P-26, P-16).
- Notifications are recipient-scoped for read and mark-read (S-13b, S-13c).

**Risks not confirmed by execution**

- `deriveStatus` uses the server's local date. If the backend runs in UTC (common on cloud hosts) while users are in Manila, "today" lags by 8 hours, so Overdue/At Risk can flip up to one day late in the early morning. The test server ran in Asia/Manila.
- `lib/r2.js` assumes a public-read bucket (its own comment says to confirm). If the bucket is private, every evidence link and the PM review thumbnail will break.
- Because the alert insert shares the transaction, a notification failure would roll back the task creation or acknowledgement itself.

## G. Dependency and blocker register

Only F5.3 is hard-blocked by F4; everything else in scope was testable. Nothing in F4 or F10 was changed.

| ID | Blocks | Dependency | Where it starts | Status | Decision or action needed |
| --- | --- | --- | --- | --- | --- |
| B-01 | F5.3 | F4 ticket system | `routes/tickets.js` POST `/` with `ticketType: "Report"`; `mobile/app/ticket-request.tsx` | BLOCKED, not tested | When F4 unblocks, test Report create/resolve. Separately decide whether a report must link to a task: `tickets` has no `taskID`, and `tasks.issueReport` is unused, so the manuscript's "visible in the task detail view" is not achievable today. |
| B-02 | F5.6 | F10 offline sync | `clientSubmissionId` contract in tasks.js L83–92 | EXCLUDED | F10 must reuse the same UUID on replay. Two contract risks found: replay after acknowledgement returns 409 (D-15), and the key isn't scoped to the task (D-05). |
| B-03 | F5.2 delivery | Cloudflare R2 credentials and bucket policy | `backend/src/lib/r2.js` | BLOCKED | Run one real upload on the hosted backend and open the returned URL in the PM review page. Confirm public read or switch to signed URLs. |
| B-04 | F3.3 reassignment | F2 project SM assignment route | `routes/projects.js` L149 | Testable; FAIL (D-02) | Fix sits in an F2 route. Agree with the route's owner before changing it. |
| B-05 | F3.4, F5.1 mobile UI | Expo app on a device | `mobile/app/site-manager*` | NOT RUN | Walk the SM flow on a phone: list → detail → photo → submit → flagged → resubmit. |
| B-06 | Login on web/mobile | Supabase Auth | `routes/auth.js`, `middleware/auth.js` | NOT RUN | Covered by a local issuer here; do one real login per role on the hosted stack. |

**Open business-rule decisions (not defects)**

- **At-risk threshold.** Code uses "within 3 days of due and not 100%". The manuscript says "at risk based on current completion percentage" / "behind its expected pace" and gives no number.
- **Task-level vs. milestone-level variance** (D-08): UC-03-01 and UC-05-01 disagree.
- **Date rules.** Past due dates, milestones after the project end date, and tasks due after their milestone are all accepted today (M-08, M-09, T-10).
- **Empty milestones in project %.** They count as 0%, which lowers project progress; matches the manuscript formula literally.
- **Assignment model.** The manuscript says the PM assigns each task to a chosen SM; the code auto-assigns the project's single SM. The code comment documents this as deliberate; the manuscript text still differs.
- **Milestone edit/delete.** No endpoints exist (M-22); confirm none are required.

## H. Recommended fix order

Fix D-01, D-03 and D-02 first: together they are the panel-visible failures, and the first two are small changes. Effort is a rough estimate for one developer.

1. **D-01 schedule variance (High, \~2–3 h).** Call `recalcMilestoneProgress` on milestone create; add a sweep every few minutes for non-Completed milestones. Settle the at-risk threshold wording before the defense.
2. **D-03 read access (High, \~1 h).** Add the GM / owning PM / assigned SM check to both milestone GET routes.
3. **D-02 reassignment (High, \~1–2 h).** Move open tasks with the SM change in one transaction. Coordinate with the owner of `projects.js`.
4. **D-04 flag visibility (Medium, \~2 h).** Return latest review status and reason from `/assigned`; show it on the mobile task card and detail. Needed to demo the flag → resubmit loop.
5. **D-06 race conditions (Medium, \~1–2 h).** Conditional review update plus a row lock; add a partial unique index for one pending row per task (new migration).
6. **D-07 file content check (Medium, \~30 min).** Magic-byte and non-empty check before upload.
7. **D-09 validation and error text (Medium, \~1–2 h).** Validate ids, dates and lengths; stop echoing Postgres messages on 500.
8. **D-05 + D-15 idempotency (Medium/Low, \~45 min).** Scope the lookup to task and user; run it before the Completed check. Tell the F10 owner the contract.
9. **D-08 task-level variance (Medium).** Decide the rule first; implement only if the panel will follow UC-05-01.
10. **Low items D-10…D-14, D-16.** Milestone name in alerts and review cards, active-project check, trim, names in `/assigned`, assignment notification.

After each fix, add its regression check (section D) to `backend/test/` so CI's `npm test` starts covering F3/F5. Re-run `run-suite.js` against a fresh database before merging.

## I. Final assessment

**Not ready for an unscripted demonstration; ready for a scripted happy-path demo.** Of the 12 in-scope requirements, three are verified clean, four are verified with defects, four are defective, and one is blocked.

| Req | Assessment | Basis |
| --- | --- | --- |
| F3.1 Create milestone | Verified, with defects | Happy path passes in API and UI; D-03, D-09, D-11, D-12 |
| F3.2 Create task | Verified, with defects | Happy path passes in API and UI; D-09 |
| F3.3 Assign to SM | Defective | Correct at creation; reassignment breaks ownership (D-02); no SM notification (D-16) |
| F3.4 View assigned tasks | Verified (API); mobile UI unverified | Correct scoping; mobile not run; D-03, D-14 |
| F3.5 Milestone % (mean) | Verified | Seven math checks against independent values |
| F3.6 Project % | Verified | Matches manuscript formula; UI matches DB |
| F3.7 Variance alert | Defective | Works only on task create/acknowledge; no time-based detection (D-01) |
| F5.1 Binary update + PM review | Verified, with defects | Full lifecycle passes; D-04, D-05, D-06, D-13 |
| F5.2 Photo JPEG/PNG ≤ 10 MB | Defective | Size enforced exactly; content not validated (D-07); real R2 blocked |
| F5.3 Issue report | Blocked | F4 dependency; no task linkage |
| F5.4 Auto-recalculate | Verified | Acknowledge propagates to milestone and project; pending/flagged excluded |
| F5.5 Variance after updates | Defective | Fires on acknowledge (S-14); not on time passing (D-01) or late tasks (D-08) |
| F5.6 Offline via F10 | Excluded | Contract concerns D-05, D-15 |

**Safe to demo today, in this order:** create milestone → add tasks → SM submits photo (mobile, untested here) → PM acknowledges → milestone and project % update. For the alert, create a milestone due within 3 days and add a task.

**Do not demo until fixed:** a past-due milestone (shows On Track), Site Manager reassignment, the flag → resubmit loop from the SM's side, and any issue report.

**Caveats:** the mobile app, Supabase login and real R2 storage were not exercised, so their behavior on the hosted stack is unverified.
