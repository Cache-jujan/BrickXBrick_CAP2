import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createProject } from "../../api/projectsApi";
import {
  getCopySource,
  getProjectTemplate,
  listCopySources,
  listProjectTemplates,
  previewProjectStructure,
} from "../../api/projectTemplatesApi";
import { extractErrorMessage } from "../../api/client";
import { BackLink } from "../../components/ui/BackLink";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { ProjectForm, EMPTY_PROJECT_FORM } from "../../components/projects/ProjectForm";
import { ProjectStartGallery } from "../../components/projects/ProjectStartGallery";
import { DocumentChecklist, EMPTY_SELECTION, selectionToStart } from "../../components/projects/DocumentChecklist";
import { StructurePreview } from "../../components/projects/StructurePreview";
import "./CreateProjectPage.css";

// F2: the GM records the project once the client has signed the BOM.
// It starts as Draft; the GM activates it from the project page.
//
// Three screens: pick a starting point (blank sheet, a template or a past
// project), fill in the project and untick documents it doesn't need, then
// review the milestones and dates that will be created. A blank sheet skips
// the review. The starting structure is copied once; nothing stays linked.
export function CreateProjectPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState("start"); // start | basics | review
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState([]);
  const [loadingStart, setLoadingStart] = useState(true);
  const [error, setError] = useState("");

  const [choice, setChoice] = useState(null); // null = blank sheet
  const [checklist, setChecklist] = useState(null);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  const [saved, setSaved] = useState(null); // { payload, form }
  const [preview, setPreview] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProjectTemplates(), listCopySources()])
      .then(([t, s]) => {
        if (cancelled) return;
        setTemplates(t);
        setSources(s);
      })
      .catch(() => {
        // The start screen still works as a blank sheet; say why the rest is missing.
        if (!cancelled) setError("Couldn't load the templates. You can still start with a blank project.");
      })
      .finally(() => {
        if (!cancelled) setLoadingStart(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const base = useMemo(() => {
    if (!choice) return null;
    return choice.mode === "template"
      ? { mode: "template", templateId: choice.templateId }
      : { mode: "copy", sourceProjectId: choice.sourceProjectId };
  }, [choice]);

  function changeChoice(next) {
    setChoice(next);
    setChecklist(null);
    setSelection(EMPTY_SELECTION);
    setPreview(null);
    setError("");
  }

  async function handleNext() {
    setError("");
    if (!choice) {
      setStep("basics");
      return;
    }
    setLoadingChecklist(true);
    try {
      const data = choice.mode === "template" ? await getProjectTemplate(choice.templateId) : await getCopySource(choice.sourceProjectId);
      setChecklist(data);
      setStep("basics");
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load that starting point. Please try again."));
    } finally {
      setLoadingChecklist(false);
    }
  }

  async function handleBasics(payload, form) {
    setSaved({ payload, form });
    if (!choice) {
      // Blank sheet: nothing to review.
      const project = await createProject(payload);
      navigate(`/projects/${project.projectid}`, { replace: true });
      return;
    }
    const result = await previewProjectStructure({
      start: selectionToStart(base, selection),
      startDate: payload.startDate,
      constructionStartDate: payload.constructionStartDate,
      endDate: payload.endDate,
    });
    setPreview(result);
    setStep("review");
  }

  async function handleCreate() {
    setError("");
    setCreating(true);
    try {
      const project = await createProject({ ...saved.payload, start: selectionToStart(base, selection) });
      navigate(`/projects/${project.projectid}`, { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't create the project. Please try again."));
      setCreating(false);
    }
  }

  // Project type: a template fixes it, a past project suggests it, a blank sheet leaves it open.
  const initialValues = useMemo(() => {
    const form = saved?.form || EMPTY_PROJECT_FORM;
    if (choice?.mode === "template") return { ...form, projectType: choice.projectType };
    if (choice?.mode === "copy" && !saved) return { ...form, projectType: choice.projectType || "" };
    return form;
  }, [saved, choice]);

  const stepNames = choice ? ["Start", "Details", "Review"] : ["Start", "Details"];
  const stepIndex = { start: 0, basics: 1, review: 2 }[step];

  return (
    <div className="create-project">
      {step === "start" ? (
        <BackLink to="/projects">Back to Projects</BackLink>
      ) : (
        <button
          type="button"
          className="form-back-link create-project-back"
          onClick={() => {
            setError("");
            setStep(step === "review" ? "basics" : "start");
          }}
        >
          ← Back
        </button>
      )}
      <h1 className="create-project-title">Create New Project</h1>
      <p className="create-project-steps" aria-label={`Step ${stepIndex + 1} of ${stepNames.length}`}>
        {stepNames.map((n, i) => (
          <span key={n} className={i === stepIndex ? "create-project-step-current" : ""}>
            {i + 1}. {n}
          </span>
        ))}
      </p>

      {error && <Banner tone="error" title={error} />}

      {step === "start" && (
        <div className="create-project-card">
          {loadingStart ? (
            <p>Loading…</p>
          ) : (
            <ProjectStartGallery
              templates={templates}
              sources={sources}
              value={choice}
              onChange={changeChoice}
              onNext={handleNext}
              onCancel={() => navigate("/projects")}
            />
          )}
          {loadingChecklist && <p className="create-project-hint">Loading…</p>}
        </div>
      )}

      {step === "basics" && (
        <div className="create-project-card">
          <ProjectForm
            key={choice ? `${choice.mode}-${choice.templateId || choice.sourceProjectId}` : "blank"}
            mode="create"
            initialValues={initialValues}
            onSubmit={handleBasics}
            submitLabel={choice ? "Review" : "Create Project"}
            busyLabel={choice ? "Checking…" : "Creating…"}
            cancelTo="/projects"
            onCancel={() => setStep("start")}
            cancelLabel="Back"
            lockProjectType={choice?.mode === "template"}
            siteManagerRequired={Boolean(choice)}
            extraSection={
              checklist ? <DocumentChecklist source={checklist} selection={selection} onChange={setSelection} /> : null
            }
          />
        </div>
      )}

      {step === "review" && preview && (
        <div className="create-project-card">
          <StructurePreview preview={preview} />
          <div className="create-project-actions">
            <Button type="button" variant="secondary" onClick={() => setStep("basics")} disabled={creating}>
              Back
            </Button>
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create Project"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}