"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import MonacoEditor, { type EditorDidMount } from "react-monaco-editor";
// Importing the full runtime registers the shared editor singleton and the
// built-in SQL (Monarch) language before react-monaco-editor creates the
// editor. This module is only ever loaded client-side (see source-viewer.tsx),
// so the heavy import never runs during SSR.
import * as monaco from "monaco-editor";
import styles from "./monaco-source-editor.module.css";

export type MonacoSourceEditorHandle = {
  revealLine: (line: number) => void;
};

export type MonacoSourceEditorProps = {
  value: string;
  language?: string;
  path?: string;
  highlight?: { startLine: number; endLine: number } | null;
};

const HIGHLIGHT_CLASS = "plsql-source-highlight";
const HIGHLIGHT_GUTTER_CLASS = "plsql-source-highlight--gutter";

const VIEW_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbersMinChars: 4,
  glyphMargin: false,
  folding: true,
  wordWrap: "off",
  fontSize: 12,
  lineHeight: 20,
  renderLineHighlight: "none",
  renderWhitespace: "none",
  contextmenu: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  stickyScroll: { enabled: false },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    alwaysConsumeMouseWheel: false,
  },
};

function MonacoSourceEditorBase(
  { value, language = "sql", path, highlight = null }: MonacoSourceEditorProps,
  ref: React.ForwardedRef<MonacoSourceEditorHandle>,
) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  const applyHighlight = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model || !highlight) {
      decorationsRef.current?.clear();
      return;
    }
    const maxLine = model.getLineCount();
    const startLine = Math.max(1, Math.min(highlight.startLine, maxLine));
    const endLine = Math.max(startLine, Math.min(highlight.endLine, maxLine));
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(startLine, 1, endLine, 1),
        options: {
          isWholeLine: true,
          className: HIGHLIGHT_CLASS,
          linesDecorationsClassName: HIGHLIGHT_GUTTER_CLASS,
        },
      },
    ]);
    editor.revealLineInCenter(startLine);
  }, [highlight]);

  const editorDidMount = useCallback<EditorDidMount>(
    (editor) => {
      editorRef.current = editor;
      applyHighlight();
    },
    [applyHighlight],
  );

  useEffect(() => {
    applyHighlight();
    return () => {
      decorationsRef.current?.clear();
    };
  }, [applyHighlight]);

  useImperativeHandle(
    ref,
    () => ({
      revealLine(line: number) {
        const editor = editorRef.current;
        if (!editor) return;
        const maxLine = editor.getModel()?.getLineCount() ?? 0;
        if (maxLine === 0) return;
        const target = Math.min(Math.max(1, line), maxLine);
        editor.revealLineInCenter(target);
        editor.setPosition({ lineNumber: target, column: 1 });
        editor.focus();
      },
    }),
    [],
  );

  const options = useMemo(
    () => ({
      ...VIEW_OPTIONS,
      ariaLabel: path ? `${path} source` : "Source code",
    }),
    [path],
  );

  return (
    <div className={styles.container}>
      <MonacoEditor
        width="100%"
        height="100%"
        language={language}
        value={value}
        theme="vs"
        options={options}
        editorDidMount={editorDidMount}
      />
    </div>
  );
}

const MonacoSourceEditor = forwardRef(MonacoSourceEditorBase);
MonacoSourceEditor.displayName = "MonacoSourceEditor";

export default MonacoSourceEditor;
