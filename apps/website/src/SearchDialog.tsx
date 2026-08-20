import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { PageSummary, SiteMessages } from "./types";

interface SearchDialogProps {
  readonly localePath: string;
  readonly messages: SiteMessages;
  readonly open: boolean;
  onClose: () => void;
}

function label(messages: SiteMessages, key: string, fallback: string): string {
  return messages[key] ?? fallback;
}

function score(record: PageSummary, terms: readonly string[]): number {
  const title = record.title.toLocaleLowerCase();
  const headings = record.headings.join(" ").toLocaleLowerCase();
  const text = record.text.toLocaleLowerCase();
  let value = 0;
  for (const term of terms) {
    if (!title.includes(term) && !headings.includes(term) && !text.includes(term)) return -1;
    if (title.includes(term)) value += 12;
    if (headings.includes(term)) value += 5;
    if (text.includes(term)) value += 1;
  }
  return value;
}

export function SearchDialog({
  localePath,
  messages,
  open,
  onClose,
}: SearchDialogProps): ReactNode {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<readonly PageSummary[]>([]);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || records.length > 0) return;
    const controller = new AbortController();
    void fetch("/__deckle/search-index.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`search index: ${String(response.status)}`);
        return response.json() as Promise<readonly PageSummary[]>;
      })
      .then(setRecords)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [open, records.length]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, [onClose, open]);

  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    if (terms.length === 0) return [];
    return records
      .filter((record) => record.localePath === localePath)
      .map((record) => ({ record, score: score(record, terms) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  }, [localePath, query, records]);

  if (!open) return null;
  const searchLabel = label(messages, "ui.search", "Search documentation");
  return (
    <div className="search-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={searchLabel}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            ref={input}
            value={query}
            placeholder={label(messages, "ui.searchPlaceholder", "Search pages and headings")}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
          <button type="button" onClick={onClose}>
            Esc
          </button>
        </label>
        <div className="search-results">
          {error !== "" && <p className="search-empty">{error}</p>}
          {query !== "" && error === "" && results.length === 0 && (
            <p className="search-empty">
              {label(messages, "ui.searchNoResults", "No matching pages")}
            </p>
          )}
          {results.map(({ record }) => (
            <a key={record.route} href={record.href}>
              <strong>{record.title}</strong>
              <span>{record.description || record.headings.slice(0, 2).join(" · ")}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
