import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createProject } from "../../api/projectsApi";
import { contractBodyFromReading, saveContract } from "../../api/contractApi";
import {
  getCopySource,
  getDocumentsChecklist,
  getProjectTemplate,
  listCopySources,
  listProjectTemplates,
  previewProjectStructure,
} from "../../api/projectTemplatesApi";
import { extractErrorMessage } from "../../api/client";
import { ArrowLeftIcon } from "../../components/ui/icons";
import { BackLink } from "../../components/ui/BackLink";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { ProjectForm, EMPTY_PROJECT_FORM } from "../../components/projects/ProjectForm";
import { ProjectStartGallery } from "../../components/projects/ProjectStartGallery";
import { DocumentChecklist, EMPTY_SELECTION, selectionToStart, noneTicked, countTicked } from "../../components/projects/DocumentChecklist";
import { StructurePreview } from "../../components/projects/StructurePreview";
import { ContractIntake } from "../../components/projects/ContractIntake";
import { useLocale } from "../../i18n/LocaleProvider";
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
  const { t } = useLocale();

  const [step, setStep] = useState("start"); // start | basics | review
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState([]);
  const [loadingStart, setLoadingStart] = useState(true);
  const [error, setError] = useState("");

  const [choice, setChoice] = useState(null); // null = blank sheet
  const [checklist, setChecklist] = useState(null);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  // Blank project: the permit documents of the chosen project type, all unticked: the GM ticks
  // only the ones this project needs.
  // { type, data } so a list is only used for the type it was loaded for.
  const [blankType, setBlankType] = useState("");
  const [docsChecklist, setDocsChecklist] = useState(null);

  const [saved, setSaved] = useState(null); // { payload, form }
  const [preview, setPreview] = useState(null);
  const [creating, setCreating] = useState(false);

  // Optional: a signed contract that fills the form. `reading` is what the server read from
  // it; `prefill` is the part of it that goes into the form's fields.
  const [reading, setReading] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [prefillKey, setPrefillKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProjectTemplates(), listCopySources()])
      .then(([tpls, srcs]) => {
        if (cancelled) return;
        setTemplates(tpls);
        setSources(srcs);
      })
      .catch(() => {
        // The start screen still works as a blank sheet; say why the rest is missing.
        if (!cancelled) setError(t("cp.err_templates"));
      })
      .finally(() => {
        if (!cancelled) setLoadingStart(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDocsChecklist(null);
    setSelection(EMPTY_SELECTION);
    if (choice || !blankType) return undefined;
    let cancelled = false;
    getDocumentsChecklist(blankType)
      .then((data) => {
        if (cancelled) return;
        setDocsChecklist({ type: blankType, data });
        setSelection(noneTicked(data));
      })
      .catch(() => {
        // No list: the project is created blank, as before.
      });
    return () => {
      cancelled = true;
    };
  }, [blankType, choice]);

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

  // `picked` comes from a double-click on a tile (state has not updated yet);
  // the Next button passes nothing and uses the current choice. null = blank.
  async function handleNext(picked) {
    setError("");
    const pick = picked === undefined ? choice : picked;
    if (!pick) {
      setStep("basics");
      return;
    }
    setLoadingChecklist(true);
    try {
      const data = pick.mode === "template" ? await getProjectTemplate(pick.templateId) : await getCopySource(pick.sourceProjectId);
      setChecklist(data);
      setStep("basics");
    } catch (err) {
      setError(extractErrorMessage(err, t("cp.err_start")));
    } finally {
      setLoadingChecklist(false);
    }
  }

  function applyContract(result) {
    const p = result.proposal || {};
    const next = {};
    for (const key of ["name", "clientName", "description", "projectType", "municipality", "province", "siteAddress"]) {
      if (p[key]) next[key] = p[key];
    }
    setReading(result);
    setPrefill(next);
    setPrefillKey((k) => k + 1); // the form reads its starting values once, so it is rebuilt
  }

  function clearContract() {
    setReading(null);
    setPrefill(null);
    setPrefillKey((k) => k + 1);
  }

  // The project exists first; the contract read from the file is then saved on it. If that
  // save fails (for example a missing contractor name), the GM lands on the contract page
  // to finish it there: the project itself is already created.
  async function createWithContract(payload) {
    const project = await createProject(payload);
    if (reading) {
      try {
        await saveContract(project.projectid, contractBodyFromReading(reading));
      } catch {
        navigate(`/projects/${project.projectid}/contract`, { replace: true });
        return;
      }
    }
    navigate(`/projects/${project.projectid}`, { replace: true });
  }

  async function handleBasics(payload, form) {
    setSaved({ payload, form });
    if (!choice) {
      // Blank sheet: nothing to review. With a document list for this type, it starts with
      // the ticked documents only; the PM adds the milestones.
      const hasList =
        docsChecklist?.type === payload.projectType &&
        docsChecklist.data.milestones.length > 0 &&
        countTicked(docsChecklist.data, selection) > 0;
      await createWithContract(
        hasList
          ? { ...payload, start: selectionToStart({ mode: "documents", projectType: payload.projectType }, selection) }
          : payload
      );
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
      await createWithContract({ ...saved.payload, start: selectionToStart(base, selection) });
    } catch (err) {
      setError(extractErrorMessage(err, t("cp.err_create")));
      setCreating(false);
    }
  }

  // Project type: a template fixes it, a past project suggests it, a blank sheet leaves it open.
  const initialValues = useMemo(() => {
    const form = saved?.form || { ...EMPTY_PROJECT_FORM, ...(prefill || {}) };
    if (choice?.mode === "template") return { ...form, projectType: choice.projectType };
    if (choice?.mode === "copy" && !saved) return { ...form, projectType: choice.projectType || "" };
    return form;
  }, [saved, choice, prefill]);

  const stepNames = choice ? [t("cp.step_start"), t("cp.step_details"), t("cp.step_review")] : [t("cp.step_start"), t("cp.step_details")];
  const stepIndex = { start: 0, basics: 1, review: 2 }[step];

  return (
    <div className="create-project">
      {step === "start" ? (
        <BackLink to="/projects">{t("projects.back")}</BackLink>
      ) : (
        <button
          type="button"
          className="back-link"
          onClick={() => {
            setError("");
            setStep(step === "review" ? "basics" : "start");
          }}
        >
          <ArrowLeftIcon size={16} />
          <span>{t("cp.back")}</span>
        </button>
      )}
      <h1 className="create-project-title">{t("projects.create_title")}</h1>
      <ol className="cp-steps" aria-label={t("cp.step_of", { current: stepIndex + 1, total: stepNames.length })}>
        {stepNames.map((n, i) => (
          <li
            key={n}
            className={`cp-step ${i === stepIndex ? "cp-step-current" : i < stepIndex ? "cp-step-done" : ""}`}
            aria-current={i === stepIndex ? "step" : undefined}
          >
            <span className="cp-step-num" aria-hidden="true">{i < stepIndex ? "✓" : i + 1}</span>
            <span className="cp-step-name">{n}</span>
          </li>
        ))}
      </ol>

      {error && <Banner tone="error" title={error} />}

      {step === "start" && (
        <div className="create-project-card">
          {loadingStart ? (
            <p>{t("common.loading")}</p>
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
          {loadingChecklist && <p className="create-project-hint">{t("common.loading")}</p>}
        </div>
      )}

      {step === "basics" && (
        <div className="create-project-card">
          <p className="create-project-hint">{t("cp.next_steps")}</p>
          <ContractIntake reading={reading} onRead={applyContract} onClear={clearContract} />
          <ProjectForm
            key={`${choice ? `${choice.mode}-${choice.templateId || choice.sourceProjectId}` : "blank"}-${prefillKey}`}
            mode="create"
            initialValues={initialValues}
            onSubmit={handleBasics}
            submitLabel={choice ? t("cp.step_review") : t("projects.create_submit")}
            busyLabel={choice ? t("cp.checking") : t("projects.creating")}
            cancelTo="/projects"
            onCancel={() => setStep("start")}
            cancelLabel={t("cp.back")}
            lockProjectType={choice?.mode === "template"}
            siteManagerRequired={Boolean(choice)}
            contractDurationDays={reading?.proposal?.durationWorkingDays || null}
            onProjectTypeChange={choice ? null : setBlankType}
            extraSection={
              checklist ? (
                <DocumentChecklist source={checklist} selection={selection} onChange={setSelection} />
              ) : !choice && docsChecklist?.type === blankType && docsChecklist.data.milestones.length > 0 ? (
                <DocumentChecklist source={docsChecklist.data} selection={selection} onChange={setSelection} />
              ) : null
            }
          />
        </div>
      )}

      {step === "review" && preview && (
        <div className="create-project-card">
          <StructurePreview preview={preview} />
          <div className="create-project-actions">
            <Button type="button" variant="secondary" onClick={() => setStep("basics")} disabled={creating}>
              {t("cp.back")}
            </Button>
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? t("projects.creating") : t("projects.create_submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}