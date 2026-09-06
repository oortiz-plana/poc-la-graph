import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MonacoSourceEditor, {
  type MonacoSourceEditorHandle,
} from "./monaco-source-editor";

const mocks = vi.hoisted(() => {
  const decorations = { clear: vi.fn() };
  let lastDecorations: unknown[] = [];
  const editor = {
    getModel: vi.fn(() => ({ getLineCount: () => 12 })),
    createDecorationsCollection: vi.fn((next: unknown[]) => {
      lastDecorations = next;
      return decorations;
    }),
    revealLineInCenter: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
  };
  return {
    editor,
    decorations,
    lastDecorations: () => lastDecorations,
  };
});

type EditorProps = {
  value?: string;
  language?: string;
  theme?: string;
  options?: Record<string, unknown>;
  editorDidMount?: (editor: unknown, monaco: unknown) => void;
};

vi.mock("react-monaco-editor", () => ({
  default: ({ editorDidMount, ...props }: EditorProps) => {
    editorDidMount?.(mocks.editor, {});
    // Expose the received props for assertions via a module-level captured slot.
    (globalThis as { __monacoProps?: EditorProps }).__monacoProps = props;
    return null;
  },
}));

function renderedProps(): EditorProps {
  return (globalThis as { __monacoProps?: EditorProps }).__monacoProps ?? {};
}

describe("MonacoSourceEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as { __monacoProps?: EditorProps }).__monacoProps;
  });

  it("renders a read-only SQL editor in view mode", () => {
    render(
      <MonacoSourceEditor
        value="FUNCTION get_salary RETURN NUMBER;"
        path="hr/pkg_emp.pkb"
      />,
    );

    expect(renderedProps().value).toBe("FUNCTION get_salary RETURN NUMBER;");
    expect(renderedProps().language).toBe("sql");
    expect(renderedProps().theme).toBe("vs");
    expect(renderedProps().options).toMatchObject({
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      contextmenu: false,
    });
  });

  it("creates a whole-line highlight decoration and reveals it", () => {
    render(
      <MonacoSourceEditor
        value="a\nb\nc"
        highlight={{ startLine: 2, endLine: 3 }}
      />,
    );

    const decorations = mocks.lastDecorations() as Array<{
      range: { startLineNumber: number; endLineNumber: number };
      options: { isWholeLine: boolean; className: string };
    }>;
    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.startLineNumber).toBe(2);
    expect(decorations[0].range.endLineNumber).toBe(3);
    expect(decorations[0].options.isWholeLine).toBe(true);
    expect(decorations[0].options.className).toBe("plsql-source-highlight");
    expect(mocks.editor.revealLineInCenter).toHaveBeenCalledWith(2);
  });

  it("clears decorations when no highlight is present", () => {
    render(<MonacoSourceEditor value="a\nb\nc" highlight={null} />);

    expect(mocks.editor.createDecorationsCollection).not.toHaveBeenCalled();
  });

  it("exposes revealLine through the forwarded ref", () => {
    const ref = createRef<MonacoSourceEditorHandle>();
    render(<MonacoSourceEditor value="a\nb\nc" ref={ref} />);

    ref.current?.revealLine(5);

    expect(mocks.editor.revealLineInCenter).toHaveBeenCalledWith(5);
    expect(mocks.editor.setPosition).toHaveBeenCalledWith({
      lineNumber: 5,
      column: 1,
    });
    expect(mocks.editor.focus).toHaveBeenCalled();
  });
});
