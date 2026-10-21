"use client";

import useSWR from "swr";
import { problemCodeOf } from "./analysis-error";

type PagedQuery<T> = {
  /**
   * Identifies the list (object, filters, tab…) without its page number. `null`
   * keeps the query idle, e.g. before a form is submitted.
   */
  listKey: string | null;
  /** 0-based. */
  page: number;
  fetchPage: (page: number) => Promise<T>;
};

/**
 * One server-side page of a list. The previous page stays in `data` while the
 * next loads, so the table never blanks out between pages; data of another
 * list (different object, filter or tab) is never shown in its place.
 */
export function usePagedQuery<T>({ listKey, page, fetchPage }: PagedQuery<T>) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    listKey === null ? null : { resource: "plsql-page", listKey, page },
    async () => ({ listKey, value: await fetchPage(page) }),
    { keepPreviousData: true },
  );
  const sameList = data !== undefined && data.listKey === listKey;
  return {
    data: sameList ? data.value : undefined,
    loading: isLoading || (data !== undefined && !sameList),
    refreshing: isValidating && sameList,
    failed: error !== undefined,
    errorCode: error ? (problemCodeOf(error) ?? "unknown") : undefined,
    retry: () => void mutate(),
  };
}
