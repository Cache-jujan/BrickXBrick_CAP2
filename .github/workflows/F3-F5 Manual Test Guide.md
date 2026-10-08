# F3 & F5 Manual Test Guide

Companion to `BrickXBrick F3 & F5 QA Audit Report.md`. Walks through manually
verifying all 16 defect fixes (D-01 through D-16) against a running backend.
Each section names the role needed, the steps, and what a pass looks like.

## 0. Setup

**Get an auth token per role.** The frontend stores the session token in
`localStorage` under `bxb_token` after login.

1. Run the frontend (`npm run dev` in `frontend/`) and log in as the role
   you need for a given check.
2. Open DevTools → Console and run:
   ```js
   localStorage.getItem("bxb_token")
   ```
3. Copy that value. You'll pass it as `$TOKEN` in the curl examples below:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/...
   ```

Repeat for each role you need (Project Manager, Site Manager, General
Manager, Purchaser). Keep a few tabs/browsers open logged in as different
roles if you're cross-checking access boundaries (D-03).

**Dev data reference** (as seeded in this project's Neon DB at time of
writing — check `SELECT name, role FROM users;` / `SELECT name, projectid
FROM projects;` if these have changed):

| Role | Name |
| --- | --- |
| Project Manager | Test PM |
| Site Manager | Test SM |
| Site Manager | Test SM 2 |
| General Manager | Test GM |
| Purchaser | Test Purchaser |

Projects like **Alpha Project**, **Bravo Project**, and **Consolacion
Townhouse Renovation Project** already have milestones/tasks and are good
candidates below. Pull their IDs with:
```sql
SELECT projectid, name, projectmanagerid, sitemanagerid FROM projects ORDER BY name;
```

---

## D-01 / D-08 / D-10 — Schedule variance sweep

**What changed:** a milestone/task that goes past due with no activity now
flips status and alerts on its own, via a periodic sweep (every 2 minutes),
not just on task-create or PM Acknowledge. Alert text now includes the
milestone name.

**Manual test (fastest — force it instead of waiting):**
1. As PM, create a milestone with a due date of **yesterday** (`POST
   /api/milestones` or the Create Milestone page).
2. Check the milestone immediately (project overview page, or `GET
   /api/milestones/:id`) — it should already show **Overdue**, not "On
   Track" (this part fires on create, no wait needed).
3. Add a task to a different, existing milestone whose due date you set to
   the past (`UPDATE tasks SET dueDate = CURRENT_DATE - 3 WHERE taskId =
   '...'` via psql, or just pick a real overdue task already in the seed
   data).
4. Wait up to 2 minutes (or restart the backend to reset the timer) and
   check:
   - `GET /api/notifications` as the PM — you should see a new
     `ScheduleVarianceAlert` whose `relatedEntityType` is `Task`, and the
     message names the task.
   - The milestone's own alert (if it also crossed into At Risk/Overdue)
     should name **both** the milestone and the project, e.g.
     `Milestone "Foundation" on project "Alpha Project" is now Overdue...`
5. Wait another 2 minutes — confirm no duplicate alert was created for the
   same task/milestone (check `SELECT COUNT(*) FROM notifications WHERE
   relatedEntityId = '...'` — should stay at 1).
6. Mark the task `Completed` (or Acknowledge its submission) — confirm the
   next sweep does **not** alert on it again.

**Pass:** Overdue/At Risk detected without any task-create or Acknowledge
action; one alert per transition; milestone name present in the message.

---

## D-02 — Site Manager reassignment moves open tasks

**What changed:** `PATCH /api/projects/:id/site-manager` now moves every
open (non-Completed) task to the new SM, and refuses to clear the SM while
open tasks remain.

**Manual test:**
1. Pick a project with an assigned SM and at least one non-Completed task
   (e.g. Consolacion Townhouse Renovation Project).
2. As the old SM, confirm you can see the task: `GET /api/tasks/assigned`
   should list it.
3. As the owning PM or a GM, reassign the SM:
   ```bash
   curl -X PATCH http://localhost:3000/api/projects/<projectId>/site-manager \
     -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
     -d '{"siteManagerId": "<newSmUserId>"}'
   ```
4. As the **old** SM, call `GET /api/tasks/assigned` again — the task
   should be **gone**.
5. As the **new** SM, call `GET /api/tasks/assigned` — the task should now
   **appear**.
6. Pick a project where that task is already `Completed` and reassign its
   SM — confirm the Completed task's `assignedTo` does **not** change
   (query `SELECT assignedTo FROM tasks WHERE taskId = '...'` before/after).
7. Try clearing the SM entirely while open tasks remain:
   ```bash
   curl -X PATCH http://localhost:3000/api/projects/<projectId>/site-manager \
     -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
     -d '{"siteManagerId": null}'
   ```
   Expect **409**, with a message naming how many open tasks are blocking it.

**Pass:** old SM loses access, new SM gains it, Completed tasks keep their
original assignee, clearing is blocked while open tasks exist.

---

## D-03 — Cross-project read access

**What changed:** `GET /api/milestones?projectId=` and `GET
/api/milestones/:id` now require GM / the owning PM / the assigned SM.

**Manual test:**
1. As a PM who does **not** own a given project (or as the Purchaser, or as
   an SM not assigned to it), call:
   ```bash
   curl -H "Authorization: Bearer $OTHER_TOKEN" \
     "http://localhost:3000/api/milestones?projectId=<someProjectId>"
   ```
   Expect **403**.
2. Same for a specific milestone: `GET /api/milestones/<milestoneId>` —
   expect **403** for the unrelated role.
3. As the owning PM, the assigned SM, or a GM, repeat the same calls —
   expect **200** with the milestone/task data.

**Pass:** only GM / owning PM / assigned SM get data back; everyone else
gets 403, including nested task data and photo URLs.

---

## D-04 — Flag visibility for the Site Manager

**What changed:** `GET /api/tasks/assigned` now returns the latest review
status/reason for each task, not just a pending photo URL.

**Manual test:**
1. As an SM, submit progress on a task (`POST /api/tasks/:id/progress` with
   a photo, or the mobile app's "Submit for PM review").
2. As the owning PM, flag it with a reason:
   ```bash
   curl -X PATCH http://localhost:3000/api/tasks/progress-log/<logId>/review \
     -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
     -d '{"decision": "Flag", "reason": "Photo too dark, retake"}'
   ```
3. As the SM, call `GET /api/tasks/assigned` again — the task should now
   include `latestreviewstatus: "Flagged"` and `latestreviewreason: "Photo
   too dark, retake"`.
4. On the mobile app (site-manager task list / detail screen), confirm the
   flagged task shows a "Flagged — resubmission needed" indicator with the
   reason visible.

**Pass:** the SM can see a submission was flagged and why, without asking
the PM.

---

## D-05 / D-15 — Idempotency key scoping and ordering

**What changed:** the `clientSubmissionId` replay check is now scoped to
`task + submitter` (not global), and runs **before** the Completed check.

**Manual test (D-05 — cross-task/user reuse rejected):**
1. As SM1, submit progress on Task A with `clientSubmissionId: "abc-123"`.
2. As SM2 (or SM1 on a **different** task), submit with the **same**
   `clientSubmissionId: "abc-123"`.
   Expect **409** ("already in use by a different task or submitter"), not
   SM1's row being returned.

**Manual test (D-15 — replay after Acknowledge returns the original row):**
1. As SM, submit progress with `clientSubmissionId: "replay-test-1"`.
2. As PM, Acknowledge that submission (task flips to Completed).
3. As the same SM, resend the **exact same** request (same task, same
   `clientSubmissionId: "replay-test-1"`, same photo).
   Expect **200** with the original log row returned — **not** a 409
   "already completed" error.

**Pass:** reused IDs across task/user → 409; replay of an already-processed
submission by its rightful owner → 200 with the original row.

---

## D-06 — Race conditions (concurrent submit / concurrent review)

These are genuinely hard to trigger by hand one request at a time — use two
terminals or a small script to fire requests at the same instant.

**Manual test (concurrent submits):**
```bash
# Terminal 1 and Terminal 2, fired as close together as possible:
curl -X POST http://localhost:3000/api/tasks/<taskId>/progress \
  -H "Authorization: Bearer $SM_TOKEN" \
  -F "clientSubmissionId=$(uuidgen)" -F "note=race test A" -F "photo=@photo1.jpg" &
curl -X POST http://localhost:3000/api/tasks/<taskId>/progress \
  -H "Authorization: Bearer $SM_TOKEN" \
  -F "clientSubmissionId=$(uuidgen)" -F "note=race test B" -F "photo=@photo2.jpg" &
wait
```
Then: `SELECT COUNT(*) FROM task_progress_log WHERE taskId = '<taskId>' AND
reviewStatus = 'Pending Review';` — expect **1**, not 2.

**Manual test (concurrent Acknowledge + Flag):**
```bash
curl -X PATCH http://localhost:3000/api/tasks/progress-log/<logId>/review \
  -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
  -d '{"decision": "Acknowledge"}' &
curl -X PATCH http://localhost:3000/api/tasks/progress-log/<logId>/review \
  -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
  -d '{"decision": "Flag", "reason": "race test"}' &
wait
```
Expect exactly **one** request to succeed (200) and the other to get **409**
("already reviewed"). Confirm the task and log end up in a *consistent*
state (not Flagged-log-but-Completed-task).

**Pass:** no duplicate Pending rows from concurrent submits; exactly one
reviewer action wins on concurrent review.

---

## D-07 — Photo content validation

**What changed:** evidence photos are now checked by magic bytes, not just
declared MIME type.

**Manual test:**
```bash
# A text file renamed to look like a photo:
echo "not a real photo" > fake.jpg
curl -X POST http://localhost:3000/api/tasks/<taskId>/progress \
  -H "Authorization: Bearer $SM_TOKEN" \
  -F "clientSubmissionId=$(uuidgen)" -F "photo=@fake.jpg;type=image/jpeg"
```
Expect **400** ("photo content does not match a valid JPEG or PNG file").

Repeat with:
- A 0-byte file (`touch empty.jpg`).
- A real `.png` renamed to `.jpg` and sent with `type=image/jpeg` (should
  still be rejected — content doesn't match the *declared* type's magic
  bytes).
- A genuine JPEG/PNG — should succeed (**201**).

**Pass:** only files with real JPEG/PNG magic bytes matching the declared
type are accepted.

---

## D-09 — Input validation / error leakage

**What changed:** malformed input (bad UUID, bad date) now returns a clean
400 instead of a 500 with raw Postgres error text.

**Manual test:**
```bash
curl -H "Authorization: Bearer $PM_TOKEN" \
  "http://localhost:3000/api/milestones?projectId=not-a-uuid"
```
Expect **400** with a generic message (e.g. `{"error":"Invalid input
value"}`) — **not** a 500 containing text like `invalid input syntax for
type uuid`.

Try a few more malformed inputs: a bad milestone ID in the URL path, a
garbage `dueDate` string on milestone/task creation.

**Pass:** no raw database error text ever reaches the response body;
input-shaped errors come back as 400.

---

## D-11 — Archived projects reject new milestones/tasks

**What changed:** creating a milestone or task on a non-Active project now
returns 409.

**Manual test:**
1. Find or create a project and set it to Archived:
   `UPDATE projects SET status = 'Archived' WHERE projectid = '...';`
2. As the owning PM, try to create a milestone on it:
   ```bash
   curl -X POST http://localhost:3000/api/milestones \
     -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
     -d '{"projectID": "<archivedProjectId>", "name": "Should fail", "dueDate": "2026-12-01"}'
   ```
   Expect **409** ("This project is Archived, not Active...").
3. Try adding a task to an existing milestone under that same archived
   project — expect **409** as well.

**Pass:** no new milestones or tasks can be created on a non-Active project.

---

## D-12 — Milestone name trimming

**What changed:** a whitespace-only milestone name is now rejected
server-side (the web UI already trimmed, but the API didn't).

**Manual test:**
```bash
curl -X POST http://localhost:3000/api/milestones \
  -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
  -d '{"projectID": "<projectId>", "name": "   ", "dueDate": "2026-12-01"}'
```
Expect **400** ("projectID, name, and dueDate are required").

**Pass:** whitespace-only names are rejected, not silently stored.

---

## D-13 — PM review card shows project/milestone names

**What changed:** `GET /api/tasks/progress-log` now returns milestone and
project names, not just a milestone UUID.

**Manual test:**
1. As a PM with a pending submission in their queue, call:
   ```bash
   curl -H "Authorization: Bearer $PM_TOKEN" \
     "http://localhost:3000/api/tasks/progress-log?status=Pending Review"
   ```
   Confirm the response includes `milestoneName` and `projectName` fields.
2. On the web Progress Review page, confirm the card shows
   `<Project> · <Milestone>` instead of a raw UUID.

**Pass:** no raw milestone UUID visible on the review card.

---

## D-14 — Assigned tasks show project/milestone names

**What changed:** `GET /api/tasks/assigned` now joins in milestone/project
names.

**Manual test:**
```bash
curl -H "Authorization: Bearer $SM_TOKEN" http://localhost:3000/api/tasks/assigned
```
Confirm each task object includes `milestonename` and `projectname`. On the
mobile app's task list/detail screens, confirm the project/milestone name is
now visible (not just the task name and due date).

**Pass:** an SM with tasks on multiple projects can tell them apart without
cross-referencing IDs.

---

## D-16 — Notification on task assignment

**What changed:** creating a task now sends the assigned SM a
`TaskAssigned` notification.

**Manual test:**
1. As a PM, create a task under a milestone that has an assigned SM:
   ```bash
   curl -X POST http://localhost:3000/api/milestones/<milestoneId>/tasks \
     -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
     -d '{"taskName": "New notif test task", "dueDate": "2026-12-01"}'
   ```
2. As that SM, call `GET /api/notifications` — expect a new notification
   with `type: "TaskAssigned"` naming the task and due date.

**Pass:** the SM finds out about a new task without having to refresh their
task list to notice it appeared.

---

## Quick checklist

| ID | One-line check | Pass? |
| --- | --- | --- |
| D-01 | Past-due milestone flips to Overdue without a task/Acknowledge action | ☐ |
| D-02 | Reassigning SM moves open tasks; old SM loses access, new SM gains it | ☐ |
| D-03 | Unrelated PM/SM/Purchaser gets 403 reading another project's milestones | ☐ |
| D-04 | `/assigned` shows Flagged status + reason | ☐ |
| D-05 | Reused `clientSubmissionId` across task/user → 409 | ☐ |
| D-06 | Concurrent submits → 1 Pending row; concurrent review → 1 winner | ☐ |
| D-07 | Fake/corrupt photo content rejected despite correct declared MIME | ☐ |
| D-08 | Overdue task under an on-track milestone alerts independently | ☐ |
| D-09 | Bad UUID/date → clean 400, no raw Postgres text | ☐ |
| D-10 | Alert message includes the milestone name | ☐ |
| D-11 | Milestone/task creation on Archived project → 409 | ☐ |
| D-12 | Whitespace-only milestone name → 400 | ☐ |
| D-13 | Review card shows project/milestone names, not a UUID | ☐ |
| D-14 | `/assigned` shows project/milestone names | ☐ |
| D-15 | Replay after Acknowledge returns original row, not a false 409 | ☐ |
| D-16 | New task creates a `TaskAssigned` notification for the SM | ☐ |
