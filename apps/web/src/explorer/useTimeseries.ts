import { useEffect, useState } from "react";
import { api } from "../api/client.ts";
import type { SearchFilters, Timeseries } from "../api/client.ts";

interface State {
  data: Timeseries | null;
  loading: boolean;
  error: string | null;
}

const INITIAL: State = { data: null, loading: false, error: null };

/** Events-per-minute for the same filters as the results list. */
export function useTimeseries(projectId: string | null, filters: SearchFilters): State {
  const { q, level, service, from, to } = filters;
  const key = JSON.stringify([projectId, q, level, service, from, to]);
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (!projectId) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getTimeseries(projectId, { q, level, service, from, to })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error && error.message ? error.message : "Could not load the chart.";
        setState({ data: null, loading: false, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // `key` encodes the project and every filter value used above

  return state;
}
