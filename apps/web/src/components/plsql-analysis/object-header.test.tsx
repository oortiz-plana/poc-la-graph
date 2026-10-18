import { render, screen, within } from "@testing-library/react";
import { createRef } from "react";
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
        onSelectTab={vi.fn()}
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

  it("keeps header actions and tabs at a 44px touch size on small screens", () => {
    render(
      <>
        <ObjectHeader
          object={object}
          onSelectTab={vi.fn()}
          headingRef={createRef<HTMLHeadingElement>()}
        />
        <ObjectTabs value="overview" onChange={vi.fn()}>
          <p>panel</p>
        </ObjectTabs>
      </>,
    );
    for (const name of ["Open source", "Analyze impact", "Find path"]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "max-md:min-h-11",
      );
    }
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("max-md:min-h-11");
    }
  });
});
