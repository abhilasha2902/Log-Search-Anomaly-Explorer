import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.ts";
import type { LogItem, TemplateFilters, TemplatesResponse } from "../api/client.ts";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface ListState {
  data: TemplatesResponse | null;
  loading: boolean;
  error: string | null;
}

export function useTemplates(projectId: string | null, filters: TemplateFilters) {
  const { service, sort, minutes } = filters;
  const key = JSON.stringify([projectId, service, sort, minutes]);
  const [state, setState] = useState<ListState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!projectId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getTemplates(projectId, { service, sort, minutes })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: messageOf(error, "Could not load templates."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // `key` encodes the project and every filter used above

  return state;
}

interface EventsState {
  items: LogItem[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

/** Events of one template, loaded on demand (`enabled`), newest first, with a cursor. */
export function useTemplateEvents(projectId: string, templateId: string, enabled: boolean) {
  const [state, setState] = useState<EventsState>({
    items: [],
    nextCursor: null,
    loading: false,
    error: null,
  });
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.nextCursor;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ items: [], nextCursor: null, loading: true, error: null });
    api
      .getTemplateEvents(projectId, templateId)
      .then((page) => {
        if (!cancelled) {
          setState({ items: page.items, nextCursor: page.nextCursor, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            items: [],
            nextCursor: null,
            loading: false,
            error: messageOf(error, "Could not load events."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, templateId, enabled]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setState((s) => ({ ...s, loading: true }));
    api
      .getTemplateEvents(projectId, templateId, cursor)
      .then((page) =>
        setState((s) => ({
          items: [...s.items, ...page.items],
          nextCursor: page.nextCursor,
          loading: false,
          error: null,
        })),
      )
      .catch((error) =>
        setState((s) => ({
          ...s,
          loading: false,
          error: messageOf(error, "Could not load events."),
        })),
      );
  }, [projectId, templateId]);

  return { ...state, loadMore };
}
