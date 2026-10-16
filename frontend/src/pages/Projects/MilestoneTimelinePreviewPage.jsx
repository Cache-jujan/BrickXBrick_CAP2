import { ProjectTimeline } from "../../components/milestones/ProjectTimeline";
import "./MilestoneTimelinePreviewPage.css";

const PREVIEW_PROJECT = {
  projectid: "preview-project",
  name: "Pickleball Court Construction",
  startdate: "2026-08-31",
  enddate: "2026-11-30",
  milestones: [
    {
      milestoneid: "preview-1",
      name: "Have everything signed",
      phase: "Planning",
      startdate: "2026-09-14",
      duedate: "2026-10-16",
      status: "At Risk",
      completionpercentage: 0,
      tasks: [
        { taskid: "task-1", taskname: "Gather client requirements", startdate: "2026-09-14", duedate: "2026-09-22", status: "Pending", handledby: "General Manager" },
        { taskid: "task-2", taskname: "Draft and review contract terms", startdate: "2026-09-21", duedate: "2026-09-30", status: "Pending", handledby: "General Manager" },
        { taskid: "task-3", taskname: "Collect signatures from stakeholders", startdate: "2026-09-28", duedate: "2026-10-09", status: "Pending", handledby: "General Manager" },
        { taskid: "task-4", taskname: "Get Client", startdate: "2026-10-05", duedate: "2026-10-16", status: "Pending", handledby: "General Manager" },
      ],
    },
    {
      milestoneid: "preview-2",
      name: "Install Pickleball Equipment and Lighting",
      phase: "Construction",
      startdate: "2026-08-31",
      duedate: "2026-10-12",
      status: "Overdue",
      completionpercentage: 44,
      tasks: [
        { taskid: "task-5", taskname: "Survey site and mark court", startdate: "2026-08-31", duedate: "2026-09-07", status: "Completed", assignedtoname: "Site Manager" },
        { taskid: "task-6", taskname: "Order equipment and lighting", startdate: "2026-09-07", duedate: "2026-09-18", status: "Pending", assignedtoname: "Site Manager" },
        { taskid: "task-7", taskname: "Install pickleball court lighting", startdate: "2026-09-14", duedate: "2026-09-25", status: "Pending", assignedtoname: "Site Manager" },
        { taskid: "task-8", taskname: "Test lighting and equipment", startdate: "2026-09-25", duedate: "2026-10-05", status: "Pending" },
        { taskid: "task-9", taskname: "Final walkthrough with client", startdate: "2026-10-05", duedate: "2026-10-12", status: "Pending", assignedtoname: "Site Manager" },
      ],
    },
    {
      milestoneid: "preview-3",
      name: "Prepare Pickleball Court Base",
      phase: "Construction",
      startdate: "2026-09-21",
      duedate: "2026-10-02",
      status: "Overdue",
      completionpercentage: 0,
      tasks: [],
    },
    {
      milestoneid: "preview-4",
      name: "Construct Pickleball Court Surface",
      phase: "Construction",
      startdate: "2026-10-12",
      duedate: "2026-10-30",
      status: "On Track",
      completionpercentage: 18,
      tasks: [
        { taskid: "task-10", taskname: "Stake out court dimensions", startdate: "2026-10-12", duedate: "2026-10-15", status: "Pending", assignedtoname: "Site Manager" },
        { taskid: "task-11", taskname: "Prepare and level the court base", startdate: "2026-10-15", duedate: "2026-10-22", status: "Pending", assignedtoname: "Site Manager" },
        { taskid: "task-12", taskname: "Pour and cure the court surface", startdate: "2026-10-22", duedate: "2026-10-28", status: "Pending", assignedtoname: "Site Manager" },
        { taskid: "task-13", taskname: "Apply court markings and finish", startdate: "2026-10-28", duedate: "2026-11-04", status: "Pending", assignedtoname: "Site Manager" },
      ],
    },
  ],
};

export function MilestoneTimelinePreviewPage() {
  return (
    <main className="timeline-preview-page">
      <div className="timeline-preview-note">Local design preview · authentication bypassed only for this route</div>
      <ProjectTimeline project={PREVIEW_PROJECT} canManage onAddMilestone={() => window.alert("Add milestone preview") } onAddTask={(milestone) => window.alert(`Add task to ${milestone.name}`)} />
    </main>
  );
}
