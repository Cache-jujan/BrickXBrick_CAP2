// scheduleWindows.js — #5: non-blocking date-window warnings for milestones
// and tasks, by project phase.
//
// Planning work is expected inside [project.startDate, project.constructionStartDate].
// Construction work is expected inside [project.constructionStartDate ?? project.startDate, project.endDate].
// A date outside its phase's window is never rejected — the PM may have a
// real reason — it's just flagged back to them. Missing project dates mean
// there's no window to check against, so no warning is produced.

function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

// phase: 'Planning' | 'Construction'. project: a row with startDate/
// constructionStartDate/endDate (any casing — called with the lowercased
// column names Postgres returns, e.g. project.startdate).
function dateWindowWarning(phase, dueDate, project) {
    const due = toDate(dueDate);
    if (!due) return null;

    const start = toDate(project.startdate);
    const constructionStart = toDate(project.constructionstartdate);
    const end = toDate(project.enddate);

    if (phase === "Planning") {
        if (!start || !constructionStart) return null;
        if (due < start) {
            return `This due date is before the project's start date (${start.toDateString()}).`;
        }
        if (due > constructionStart) {
            return `This due date is after construction is set to begin (${constructionStart.toDateString()}) — Planning work is usually finished before then.`;
        }
        return null;
    }

    // Construction
    const windowStart = constructionStart || start;
    if (!windowStart || !end) return null;
    if (due < windowStart) {
        return `This due date is before construction is set to begin (${windowStart.toDateString()}).`;
    }
    if (due > end) {
        return `This due date is after the project's target completion (${end.toDateString()}).`;
    }
    return null;
}

module.exports = { dateWindowWarning };