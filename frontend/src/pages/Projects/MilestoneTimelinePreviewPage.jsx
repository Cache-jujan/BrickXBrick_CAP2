import { useMemo } from "react";
import { ProjectTimeline } from "../../components/milestones/ProjectTimeline";
import "./MilestoneTimelinePreviewPage.css";

// Dates are relative to today so the preview always shows a live project:
// "today" falls at the start of the chart, a milestone is overdue, and the plan
// runs about eight months. ?scenario=mockup drops the extra overdue milestone so
// the chart matches the design mockups; ?scenario=empty shows a project with none.
const DAY_MS = 24 * 60 * 60 * 1000;

function dayOffset(offset) {
  const date = new Date(Date.now() + offset * DAY_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Spreads task names evenly between two day offsets; the first `done` are Completed.
function spread(prefix, names, from, to, done = 0, who = { assignedtoname: "Site Manager" }) {
  const step = (to - from) / names.length;
  return names.map((taskname, index) => ({
    taskid: `${prefix}-${index + 1}`,
    taskname,
    startdate: dayOffset(Math.round(from + step * index)),
    duedate: dayOffset(Math.round(from + step * (index + 1))),
    status: index < done ? "Completed" : "Pending",
    ...who,
  }));
}

const PERMIT_TASKS = [
  "Confirm business use, occupancy, site, and client requirements",
  "Unified Application Form for Building Permit",
  "Architectural permit/plans",
  "Civil/structural permit or structural plans",
  "Electrical permit",
  "Sanitary permit",
  "Plumbing permit",
  "Certificate of supervising architect/engineer",
  "Bill of Materials",
  "Construction specifications",
  "Structural design analysis (when applicable)",
  "Signed and sealed plans from the responsible professionals",
  "Professional licenses and PTR copies",
  "Barangay clearance",
  "Certified tax declaration and current tax clearance",
];

function buildProject(scenario) {
  if (scenario === "empty") {
    return { projectid: "preview-project", name: "Empty Project", startdate: dayOffset(0), enddate: dayOffset(60), milestones: [] };
  }
  const general = { handledby: "General Manager" };
  const milestones = [
    {
      milestoneid: "preview-survey",
      name: "Soil Test and Site Survey",
      phase: "Planning",
      startdate: dayOffset(-24),
      duedate: dayOffset(-6),
      status: "Overdue",
      completionpercentage: 67,
      tasks: spread("survey", ["Book the soil testing lab", "Collect and submit soil samples", "Review the soil report"], -24, -6, 2, general),
    },
    {
      milestoneid: "preview-scope",
      name: "Commercial Scope and Permits",
      phase: "Planning",
      startdate: dayOffset(0),
      duedate: dayOffset(34),
      status: "On Track",
      completionpercentage: 14,
      tasks: PERMIT_TASKS.map((taskname, index) => ({
        taskid: `permit-${index + 1}`,
        taskname,
        startdate: dayOffset(index * 2),
        duedate: dayOffset(index * 2 + 4),
        status: index < 2 ? "Completed" : "Pending",
        ...general,
      })),
    },
    {
      milestoneid: "preview-contract",
      name: "Contract and Mobilization",
      phase: "Planning",
      startdate: dayOffset(34),
      duedate: dayOffset(55),
      status: "On Track",
      completionpercentage: 0,
      tasks: spread("contract", ["Draft the construction contract", "Review terms with the client", "Collect signatures", "Release the mobilization payment", "Notify the site team", "Hold the kickoff meeting"], 34, 55, 0, general),
    },
    {
      milestoneid: "preview-site",
      name: "Site Preparation and Foundation",
      phase: "Construction",
      startdate: dayOffset(55),
      duedate: dayOffset(100),
      status: "At Risk",
      completionpercentage: 0,
      tasks: spread("site", ["Clear and grade the site", "Stake out the foundation", "Excavate footings", "Pour the foundation"], 55, 100),
    },
    {
      milestoneid: "preview-framing",
      name: "Structural Framing",
      phase: "Construction",
      startdate: dayOffset(100),
      duedate: dayOffset(170),
      status: "Pending",
      completionpercentage: 0,
      tasks: [],
    },
    {
      milestoneid: "preview-roofing",
      name: "Roofing and Enclosure",
      phase: "Construction",
      startdate: dayOffset(170),
      duedate: dayOffset(219),
      status: "Pending",
      completionpercentage: 0,
      tasks: spread("roof", ["Install roof trusses", "Lay roof sheeting", "Fit gutters and flashing", "Install windows and doors", "Weatherproof the walls"], 170, 219),
    },
    {
      milestoneid: "preview-final",
      name: "Final Inspection and Turnover",
      phase: "Construction",
      startdate: dayOffset(219),
      duedate: dayOffset(245),
      status: "Pending",
      completionpercentage: 0,
      tasks: spread("final", ["Walk through with the client", "Fix the punch list", "Hand over keys and documents"], 219, 245),
    },
  ];
  const kept = scenario === "mockup" ? milestones.slice(1) : milestones;
  return {
    projectid: "preview-project",
    sitemanagerid: scenario === "no-sm" ? null : "preview-sm",
    name: "Pickleball Court Construction",
    startdate: dayOffset(scenario === "mockup" ? 0 : -24),
    enddate: dayOffset(245),
    milestones: kept,
  };
}

export function MilestoneTimelinePreviewPage() {
  const project = useMemo(() => buildProject(new URLSearchParams(window.location.search).get("scenario") || ""), []);
  return (
    <main className="timeline-preview-page">
      <div className="timeline-preview-note">Local design preview · authentication bypassed only for this route</div>
      <ProjectTimeline
        project={project}
        canManage
        onEditTimeline={() => window.alert("Edit timeline preview")}
        onAddMilestone={() => window.alert("Add milestone preview")}
        onAddTask={(milestone) => window.alert(`Add task to ${milestone.name}`)}
        onCompleteTask={(task) => window.alert(`Mark done: ${task.taskname}`)}
        onOpenDocuments={(task) => window.alert(`Documents for ${task.taskname}`)}
      />
    </main>
  );
}
