import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject, updateProject } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { BackLink } from "../../components/ui/BackLink";
import { ProjectForm, projectToForm } from "../../components/projects/ProjectForm";
import "./CreateProjectPage.css";

const READ_ONLY = ["Completed", "Cancelled", "Archived"];

// F2: GM edits project details (adviser: "make project details editable").
export function EditProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getProject(id)
      .then((data) => { if (!cancelled) setProject(data); })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, "Couldn't load this project.")); });
    return () => { cancelled = true; };
  }, [id]);

  async function handleSave(payload) {
    await updateProject(id, payload);
    navigate(`/projects/${id}`, { replace: true });
  }

  return (
    <div className="create-project">
      <BackLink to={`/projects/${id}`}>Back to Project</BackLink>
      <h1 className="create-project-title">Edit Project</h1>

      {error && <Banner tone="error" title={error} />}
      {!error && !project && <p className="dashboard-loading">Loading project…</p>}
      {project && READ_ONLY.includes(project.status) && (
        <Banner tone="info" title={`This project is ${project.status}`}>
          Completed, cancelled and archived projects can no longer be edited.
        </Banner>
      )}
      {project && !READ_ONLY.includes(project.status) && (
        <Card className="create-project-card">
          <ProjectForm
            mode="edit"
            projectId={id}
            initialValues={projectToForm(project)}
            onSubmit={handleSave}
            submitLabel="Save Changes"
            busyLabel="Saving…"
            cancelTo={`/projects/${id}`}
          />
        </Card>
      )}
    </div>
  );
}
