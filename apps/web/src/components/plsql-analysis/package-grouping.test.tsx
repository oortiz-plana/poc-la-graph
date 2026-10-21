import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithIntl as render } from "@/test/render-with-intl";
import type { PlsqlObjectReference } from "@/lib/contracts";
import {
  groupByPackage,
  GroupExpansionProvider,
  packageKeyOf,
  useCollapsedGroups,
  type GroupExpansion,
} from "./package-grouping";

const ref = (
  kind: PlsqlObjectReference["kind"],
  qualifiedName: string,
): PlsqlObjectReference => ({
  id: `plsql://x/${qualifiedName}`,
  kind,
  name: qualifiedName.split(".").at(-1) ?? qualifiedName,
  schema: "HR",
  qualifiedName,
});

describe("packageKeyOf", () => {
  it("files a routine under its package and a package under itself", () => {
    expect(packageKeyOf(ref("Procedure", "HR.PKG.RUN"))).toBe("PKG");
    expect(packageKeyOf(ref("Package", "HR.PKG"))).toBe("PKG");
  });

  it("has no package for standalone routines, tables and views", () => {
    expect(packageKeyOf(ref("Procedure", "HR.RUN"))).toBeUndefined();
    expect(packageKeyOf(ref("Table", "HR.EMPLOYEES"))).toBeUndefined();
    expect(packageKeyOf(ref("View", "HR.V_EMP"))).toBeUndefined();
  });
});

describe("groupByPackage", () => {
  it("orders packages alphabetically, keeps item order, and puts package-less items last", () => {
    const items = [
      { id: "1", key: "ZED" },
      { id: "2", key: undefined },
      { id: "3", key: "ALFA" },
      { id: "4", key: "ZED" },
    ];
    const groups = groupByPackage(items, (item) => item.key);
    expect(groups.map((group) => group.packageName)).toEqual([
      "ALFA",
      "ZED",
      undefined,
    ]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["1", "4"]);
  });

  it("returns no groups for no items", () => {
    expect(groupByPackage([], () => "X")).toEqual([]);
  });
});

function Groups() {
  const groups = useCollapsedGroups();
  return (
    <ul>
      {["ALFA", "BETA"].map((name) => (
        <li key={name}>
          <button type="button" onClick={() => groups.toggle(name)}>
            {name}: {groups.isCollapsed(name) ? "closed" : "open"}
          </button>
        </li>
      ))}
    </ul>
  );
}

const withCommand = (command: GroupExpansion) => (
  <GroupExpansionProvider value={command}>
    <Groups />
  </GroupExpansionProvider>
);

describe("useCollapsedGroups", () => {
  it("starts open and toggles one group at a time", async () => {
    render(withCommand({ mode: "expanded", epoch: 0 }));
    expect(screen.getByText("ALFA: open")).toBeInTheDocument();
    await userEvent.click(screen.getByText("ALFA: open"));
    expect(screen.getByText("ALFA: closed")).toBeInTheDocument();
    expect(screen.getByText("BETA: open")).toBeInTheDocument();
  });

  it("collapses and expands every group on a workspace command, discarding manual toggles", async () => {
    const { rerender } = render(withCommand({ mode: "expanded", epoch: 0 }));
    await userEvent.click(screen.getByText("ALFA: open"));

    rerender(withCommand({ mode: "collapsed", epoch: 1 }));
    expect(screen.getByText("ALFA: closed")).toBeInTheDocument();
    expect(screen.getByText("BETA: closed")).toBeInTheDocument();

    // After "collapse all" a single group can still be opened.
    await userEvent.click(screen.getByText("BETA: closed"));
    expect(screen.getByText("BETA: open")).toBeInTheDocument();
    expect(screen.getByText("ALFA: closed")).toBeInTheDocument();

    rerender(withCommand({ mode: "expanded", epoch: 2 }));
    expect(screen.getByText("ALFA: open")).toBeInTheDocument();
    expect(screen.getByText("BETA: open")).toBeInTheDocument();
  });

  it("starts a newly mounted table in the last commanded mode", () => {
    render(withCommand({ mode: "collapsed", epoch: 3 }));
    expect(screen.getByText("ALFA: closed")).toBeInTheDocument();
  });
});
