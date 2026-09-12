import { useCallback, useEffect, useState } from "react";
import { listProjects } from "../api/projectsApi";
import { extractErrorMessage } from "../api/client";

export function useProjects(status) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listProjects(status);
      setProjects(data);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't load projects."));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { projects, loading, error, reload };
}
