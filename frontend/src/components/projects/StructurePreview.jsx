import { Banner } from "../ui/Banner";
import "./StructurePreview.css";

const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });

// YYYY-MM-DD -> "Jan 25, 2027" without a time-zone shift.
function fmt(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return DATE.format(new Date(y, m - 1, d));
}

const OWNER = { GM: "GM", PM: "PM" };

// Last screen of "New project": what will be created, with the dates worked out
// from the project dates. Nothing is saved until the GM confirms.
export function StructurePreview({ preview }) {
  const { milestones, omittedMilestones, counts, warnings } = preview;
  return (
    <section className="sp" aria-label="What will be created">
      <h2 className="sp-title">
        {counts.milestones} milestones and {counts.tasks} tasks
        {preview.source ? ` from ${preview.source.kind === "template" ? "the template" : "the project"} "${preview.source.name}"` : ""}
      </h2>
      <p className="sp-sub">
        Everything starts Pending at 0%. Planning tasks belong to the General Manager or Project Manager;
        construction tasks go to the Site Manager. The Project Manager can change any date or name afterwards.
      </p>

      {warnings.length > 0 && (
        <Banner tone="warning" title={`${warnings.length} date${warnings.length === 1 ? " falls" : "s fall"} outside the project's dates`}>
          They will still be saved. Move the project dates, or edit the timeline after creating.
        </Banner>
      )}
      {omittedMilestones.length > 0 && (
        <Banner tone="info" title="Not created (no tasks left)">{omittedMilestones.join(", ")}</Banner>
      )}

      <ol className="sp-list">
        {milestones.map((m, i) => (
          <li key={`${m.name}-${i}`} className="sp-milestone">
            <div className="sp-head">
              <span className="sp-num">{i + 1}</span>
              <strong className="sp-name">{m.name}</strong>
              <span className="sp-phase">{m.phase}</span>
              <span className={`sp-date ${m.warning ? "sp-date-warn" : ""}`} title={m.warning || undefined}>
                Due {fmt(m.dueDate)}
              </span>
            </div>
            <ul className="sp-tasks">
              {m.tasks.map((t, j) => (
                <li key={`${t.name}-${j}`} className="sp-task">
                  <span className="sp-num">{i + 1}.{j + 1}</span>
                  <span className="sp-name">{t.name}</span>
                  {t.handledBy && <span className="sp-owner">{OWNER[t.handledBy]}</span>}
                  <span className={`sp-date ${t.warning ? "sp-date-warn" : ""}`} title={t.warning || undefined}>
                    {fmt(t.dueDate)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
