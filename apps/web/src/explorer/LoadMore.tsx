interface Props {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

export function LoadMore({ hasMore, loading, onLoadMore }: Props) {
  if (!hasMore) return null;
  return (
    <div className="load-more">
      <button type="button" onClick={onLoadMore} disabled={loading}>
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
