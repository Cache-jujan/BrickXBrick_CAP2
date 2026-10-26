import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProject, updateProject } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../../components/ui/Banner";
import { BackLink } from "../../components/ui/BackLink";
import { ProjectForm, projectToForm } from "../../components/projects/ProjectForm";
import { useLocale } from "../../i18n/LocaleProvider";
import "./CreateProjectPage.css";

const READ_ONLY = ["Completed", "Cancelled", "Archived"];

// F2: GM edits project details (adviser: "make project details editable").
export function EditProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, tv } = useLocale();
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getProject(id)
      .then((data) => { if (!cancelled) setProject(data); })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, t("errors.load_project"))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the project changes, not on a language change
  }, [id]);

  async function handleSave(payload) {
    await updateProject(id, payload);
    navigate(`/projects/${id}`, { replace: true });
  }

  return (
    <div className="create-project">
      <BackLink to={`/projects/${id}`}>{t("projects.back_one")}</BackLink>
      <h1 className="create-project-title">{t("nav.edit_project")}</h1>

      {error && <Banner tone="error" title={error} />}
      {!error && !project && <p className="dashboard-loading">{t("projects.loading_one")}</p>}
      {project && READ_ONLY.includes(project.status) && (
        <Banner tone="info" title={t("projects.readonly_title", { status: tv("status", project.status) })}>
          {t("projects.readonly_body")}
        </Banner>
      )}
      {project && !READ_ONLY.includes(project.status) && (
        <div className="create-project-card">
          <ProjectForm
            mode="edit"
            projectId={id}
            initialValues={projectToForm(project)}
            onSubmit={handleSave}
            submitLabel={t("projects.save_changes")}
            busyLabel={t("common.saving")}
            cancelTo={`/projects/${id}`}
            budgetLocked={project.bomstatus === "Approved"}
          />
        </div>
      )}
    </div>
  );
}
