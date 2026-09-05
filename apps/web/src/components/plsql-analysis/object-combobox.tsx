"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchPlsqlObjects } from "@/lib/api";
import type { PlsqlObject } from "@/lib/contracts";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 10;

/**
 * Visible option text for one object. Kind is included so a Package and a
 * Synonym that legitimately share a qualified name stay distinguishable.
 */
function optionLabel(object: PlsqlObject): string {
  return `${object.kind} · ${object.qualifiedName}`;
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * Debounced type-ahead object picker built on the ARIA 1.2 combobox pattern
 * (input with `aria-autocomplete="list"` + `aria-activedescendant` listbox).
 * Searches independently through the existing `/api/v1/plsql/objects?q=`
 * endpoint, so it works on any corpus without the main results list.
 */
export function PlsqlObjectCombobox({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: PlsqlObject | undefined;
  onSelect: (object: PlsqlObject | undefined) => void;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<PlsqlObject[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const requestSeq = useRef(0);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) {
      setOptions([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    const seq = ++requestSeq.current;
    setSearching(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      searchPlsqlObjects(text.trim(), { limit: SEARCH_LIMIT })
        .then((page) => {
          if (requestSeq.current !== seq) return;
          setOptions(page.items);
          setActiveIndex(-1);
          setAnnouncement(
            page.items.length === 0
              ? "No matching objects"
              : `${page.items.length} matching object${
                  page.items.length === 1 ? "" : "s"
                }`,
          );
        })
        .catch(() => {
          if (requestSeq.current !== seq) return;
          setOptions([]);
          setFailed(true);
          setAnnouncement("Object search failed");
        })
        .finally(() => {
          if (requestSeq.current === seq) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      requestSeq.current += 1;
    };
  }, [text, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const element = document.getElementById(optionId(listboxId, activeIndex));
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open, listboxId]);

  function openListbox() {
    setOpen(true);
    setSearching(true);
    setAnnouncement("");
  }

  function handleChange(value: string) {
    setText(value);
    openListbox();
    if (selected && value !== optionLabel(selected)) {
      onSelect(undefined);
    }
  }

  function select(object: PlsqlObject) {
    setText(optionLabel(object));
    setActiveIndex(-1);
    setOpen(false);
    setAnnouncement(`Selected ${object.kind} ${object.qualifiedName}.`);
    onSelect(object);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        options.length === 0
          ? -1
          : current + 1 >= options.length
            ? 0
            : current + 1,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        options.length === 0
          ? -1
          : current <= 0
            ? options.length - 1
            : current - 1,
      );
    } else if (event.key === "Home") {
      if (open && options.length > 0) {
        event.preventDefault();
        setActiveIndex(0);
      }
    } else if (event.key === "End") {
      if (open && options.length > 0) {
        event.preventDefault();
        setActiveIndex(options.length - 1);
      }
    } else if (event.key === "Enter") {
      if (!open) return; // closed: let the surrounding form submit
      event.preventDefault();
      const index =
        activeIndex >= 0 ? activeIndex : options.length === 1 ? 0 : -1;
      if (index >= 0) select(options[index]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium">
        {label}
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && activeIndex >= 0
              ? optionId(listboxId, activeIndex)
              : undefined
          }
          autoComplete="off"
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={openListbox}
          onBlur={() => {
            setOpen(false);
            setActiveIndex(-1);
          }}
          placeholder="Name or qualified name"
          className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
        />
      </label>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} matches`}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-surface shadow-lg"
        >
          {searching && (
            <li className="flex min-h-11 items-center gap-2 px-3 text-sm text-text-secondary">
              <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              Searching…
            </li>
          )}
          {!searching && failed && (
            <li className="min-h-11 px-3 py-2 text-sm text-text-secondary">
              Could not search objects
            </li>
          )}
          {!searching && !failed && options.length === 0 && (
            <li className="min-h-11 px-3 py-2 text-sm text-text-secondary">
              No matching objects
            </li>
          )}
          {!searching &&
            !failed &&
            options.map((object, index) => (
              <li
                key={object.id}
                id={optionId(listboxId, index)}
                role="option"
                aria-selected={object.id === selected?.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(object)}
                className={`min-h-11 break-words px-3 py-2 text-sm ${
                  index === activeIndex ? "bg-selected" : ""
                }`}
              >
                {optionLabel(object)}
              </li>
            ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
