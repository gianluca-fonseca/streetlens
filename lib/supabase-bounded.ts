/**
 * Paginated Supabase reads — avoids PostgREST's default ~1000-row page cliff.
 * Logs when an intentional maxRows cap truncates a result set.
 */

export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Fetch every row by paging with `.range(from, to)` until a short page.
 * Returns null when the first page fetch fails (caller may fall back).
 */
export async function fetchAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => Promise<T[] | null>,
  options?: { maxRows?: number },
): Promise<T[] | null> {
  const maxRows = options?.maxRows;
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page === null) return all.length > 0 ? all : null;
    all.push(...page);

    if (maxRows !== undefined && all.length >= maxRows) {
      if (all.length > maxRows) {
        console.warn(
          `[supabase] ${label}: truncated at ${maxRows} rows (fetched ${all.length})`,
        );
      }
      return all.slice(0, maxRows);
    }

    if (page.length < SUPABASE_PAGE_SIZE) return all;
    from += SUPABASE_PAGE_SIZE;
  }
}
