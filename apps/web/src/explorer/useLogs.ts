import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.ts";
import type { LogItem, SearchFilters } from "../api/client.ts";

interface State {
  items: LogItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const INITIAL: State = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not load logs.";
}

/** Loads the first page whenever the project or filters change; loadMore follows the cursor. */
export function useLogs(projectId: string | null, filters: SearchFilters) {
  const { q, level, service, from, to } = filters;
  const key = JSON.stringify([projectId, q, level, service, from, to]);
  const [state, setState] = useState<State>(INITIAL);
  const keyRef = useRef(key);
  keyRef.current = key;
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.nextCursor;

  useEffect(() => {
    if (!projectId) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState({ ...INITIAL, loading: true });
    api
      .getLogs(projectId, { q, level, service, from, to })
      .then((page) => {
        if (!cancelled) setState({ ...INITIAL, items: page.items, nextCursor: page.nextCursor });
      })
      .catch((error) => {
        if (!cancelled) setState({ ...INITIAL, error: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // key encodes the project and every filter value used above

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!projectId || !cursor) return;
    const startedWith = keyRef.current;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    api
      .getLogs(projectId, { q, level, service, from, to }, cursor)
      .then((page) => {
        if (keyRef.current !== startedWith) return; // filters changed while loading
        setState((s) => ({
          ...s,
          items: [...s.items, ...page.items],
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      })
      .catch((error) => {
        if (keyRef.current !== startedWith) return;
        setState((s) => ({ ...s, loadingMore: false, error: messageOf(error) }));
      });
  }, [projectId, q, level, service, from, to]);

  return { ...state, loadMore };
}
