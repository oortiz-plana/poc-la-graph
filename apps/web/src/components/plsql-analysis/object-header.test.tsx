import { screen, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlsqlObject } from "@/lib/contracts";
import { ObjectHeader, ObjectTabs } from "./object-header";

const object: PlsqlObject = {
  id: "plsql://p/HR/FUNCTION/GET_SALARY",
  kind: "Function",
  name: "GET_SALARY",
  schema: "HR",
  qualifiedName: "HR.PKG_EMP.GET_SALARY",
  projectId: "sample",
  owner: "PKG_EMP",
  signature: null,
  returnType: null,
  declaration: null,
};

describe("ObjectHeader", () => {
  it("exposes the qualified name as a breadcrumb that marks the object itself", () => {
    render(
      <ObjectHeader
        object={object}
        headingRef={createRef<HTMLHeadingElement>()}
      />,
    );
    const crumbs = screen.getByRole("navigation", { name: "Qualified name" });
    const items = within(crumbs).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.replace("/", ""))).toEqual([
      "HR",
      "PKG_EMP",
      "GET_SALARY",
    ]);
    expect(items.at(-1)).toHaveAttribute("aria-current", "location");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });

  it("has no shortcut buttons that duplicate the tabs", () => {
    render(
      <ObjectHeader
        object={object}
        headingRef={createRef<HTMLHeadingElement>()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the workspace-wide package grouping only on tabs that list objects", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ObjectTabs
        value="overview"
        onChange={vi.fn()}
        groupByPackage={false}
        onGroupByPackageChange={onChange}
      >
        <p>panel</p>
      </ObjectTabs>,
    );
    const toggle = screen.getByRole("checkbox", { name: "Group by package" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);

    for (const value of ["dependencies", "impact"] as const) {
      rerender(
        <ObjectTabs
          value={value}
          onChange={vi.fn()}
          groupByPackage
          onGroupByPackageChange={onChange}
        >
          <p>panel</p>
        </ObjectTabs>,
      );
      expect(
        screen.getByRole("checkbox", { name: "Group by package" }),
      ).toBeChecked();
    }
    for (const value of ["paths", "source"] as const) {
      rerender(
        <ObjectTabs
          value={value}
          onChange={vi.fn()}
          groupByPackage
          onGroupByPackageChange={onChange}
        >
          <p>panel</p>
        </ObjectTabs>,
      );
      expect(screen.queryByRole("checkbox")).toBeNull();
    }
  });

  it("offers Expand all / Collapse all only while grouping is on", async () => {
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    const tabs = (groupByPackage: boolean) => (
      <ObjectTabs
        value="impact"
        onChange={vi.fn()}
        groupByPackage={groupByPackage}
        onGroupByPackageChange={vi.fn()}
        onExpandAllGroups={onExpand}
        onCollapseAllGroups={onCollapse}
      >
        <p>panel</p>
      </ObjectTabs>
    );
    const { rerender } = render(tabs(false));
    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();

    rerender(tabs(true));
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("keeps the tabs at a 44px touch size on small screens", () => {
    render(
      <>
        <ObjectHeader
          object={object}
          headingRef={createRef<HTMLHeadingElement>()}
        />
        <ObjectTabs value="overview" onChange={vi.fn()}>
          <p>panel</p>
        </ObjectTabs>
      </>,
    );
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("max-md:min-h-11");
    }
  });
});
