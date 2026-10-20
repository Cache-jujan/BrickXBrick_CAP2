import { useNavigate } from "react-router-dom";
import { createProject } from "../../api/projectsApi";
import { BackLink } from "../../components/ui/BackLink";
import { ProjectForm, EMPTY_PROJECT_FORM } from "../../components/projects/ProjectForm";
import "./CreateProjectPage.css";

// F2: the GM records the project once the client has signed the BOM.
// It starts as Draft; the GM activates it from the project page.
export function CreateProjectPage() {
  const navigate = useNavigate();

  async function handleCreate(payload) {
    const project = await createProject(payload);
    navigate(`/projects/${project.projectid}`, { replace: true });
  }

  return (
    <div className="create-project">
      <BackLink to="/projects">Back to Projects</BackLink>
      <h1 className="create-project-title">Create New Project</h1>

      <div className="create-project-card">
        <ProjectForm
          mode="create"
          initialValues={EMPTY_PROJECT_FORM}
          onSubmit={handleCreate}
          submitLabel="Create Project"
          busyLabel="Creating…"
          cancelTo="/projects"
        />
      </div>
    </div>
  );
}
