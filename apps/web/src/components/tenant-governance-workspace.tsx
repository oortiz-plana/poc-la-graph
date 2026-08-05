"use client";

import { ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ApplicationShell } from "@/components/application-shell";
import { Button } from "@/components/ui/button";
import {
  addProjectMembers,
  changeProjectMemberRole,
  listGovernanceProjects,
  listProjectMembers,
  removeProjectMember,
  searchDirectory,
} from "@/lib/api";
import type {
  DirectoryPrincipal,
  GovernanceProject,
  ProjectMembership,
  ProjectRole,
} from "@/lib/contracts";
import { useAuth } from "./auth-provider";

export function TenantGovernanceWorkspace() {
  const auth = useAuth();
  const [projects, setProjects] = useState<GovernanceProject[]>([]);
  const [selected, setSelected] = useState<GovernanceProject>();
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryPrincipal[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void listGovernanceProjects()
      .then(setProjects)
      .catch(() => setError("Tenant projects could not be loaded."));
  }, []);

  async function open(project: GovernanceProject) {
    setSelected(project);
    try {
      setMembers(await listProjectMembers(project.id));
      setError(undefined);
    } catch {
      setError("Project membership could not be loaded.");
    }
  }

  async function add(principal: DirectoryPrincipal) {
    if (!selected) return;
    try {
      setMembers(await addProjectMembers(selected.id, [principal], "manager"));
      setResults([]);
      setQuery("");
    } catch {
      setError("The governance repair could not be applied.");
    }
  }

  async function search() {
    if (!selected) return;
    try {
      setResults(await searchDirectory(selected.id, query));
      setError(undefined);
    } catch {
      setError("The tenant directory could not be searched.");
    }
  }

  if (!auth.roles.has("admin")) {
    return (
      <ApplicationShell>
        <main className="p-6">
          <p
            role="alert"
            className="rounded-md border border-error-border bg-error-surface p-4 text-error"
          >
            Tenant administrator access is required.
          </p>
        </main>
      </ApplicationShell>
    );
  }

  return (
    <ApplicationShell>
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <header>
          <div className="flex items-center gap-3">
            <ShieldCheck aria-hidden className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-semibold">Tenant governance</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary">
            Discover private projects and repair membership without opening
            documents, evidence, or private conversations.
          </p>
        </header>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-error-border bg-error-surface p-3 text-error"
          >
            {error}
          </p>
        )}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <section aria-labelledby="tenant-projects-heading">
            <h2 id="tenant-projects-heading" className="text-lg font-semibold">
              Projects
            </h2>
            <ul className="mt-3 space-y-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    onClick={() => void open(project)}
                    className={`min-h-11 w-full rounded-md border p-3 text-left ${selected?.id === project.id ? "border-primary bg-selected" : "bg-surface"}`}
                  >
                    <span className="block font-medium">{project.name}</span>
                    <span className="text-xs capitalize text-text-secondary">
                      {project.state} · {project.ownerCount} Owners
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="membership-repair-heading">
            <h2
              id="membership-repair-heading"
              className="text-lg font-semibold"
            >
              Membership repair
            </h2>
            {!selected ? (
              <p className="mt-3 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
                Select a project to inspect membership.
              </p>
            ) : (
              <>
                <div className="mt-3 flex gap-2">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search tenant directory"
                    className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3"
                    placeholder="Add a provisioned user or group"
                  />
                  <Button variant="outline" onClick={() => void search()}>
                    Search
                  </Button>
                </div>
                {results.length > 0 && (
                  <ul className="mt-2 rounded-md border bg-surface">
                    {results.map((result) => (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          className="min-h-11 w-full px-3 text-left hover:bg-background"
                          onClick={() => void add(result)}
                        >
                          <Users aria-hidden className="mr-2 inline h-4 w-4" />
                          {result.displayName}{" "}
                          <span className="text-xs text-text-muted">
                            as Manager
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="mt-4 divide-y rounded-lg border bg-surface">
                  {members.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center gap-3 p-3"
                    >
                      <span className="min-w-0 flex-1 font-medium">
                        {member.displayName}
                        <span className="block text-xs text-text-muted">
                          {member.principalType}
                        </span>
                      </span>
                      <select
                        aria-label={`Role for ${member.displayName}`}
                        value={member.role}
                        onChange={(event) =>
                          void changeProjectMemberRole(
                            selected.id,
                            member.id,
                            event.target.value as ProjectRole,
                          ).then((updated) =>
                            setMembers((current) =>
                              current.map((item) =>
                                item.id === updated.id ? updated : item,
                              ),
                            ),
                          )
                        }
                        className="min-h-11 rounded-md border bg-background px-3"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="contributor">Contributor</option>
                        <option value="manager">Manager</option>
                        {member.principalType === "user" && (
                          <option value="owner">Owner</option>
                        )}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-error"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove access for ${member.displayName}?`,
                            )
                          )
                            void removeProjectMember(
                              selected.id,
                              member.id,
                            ).then(() =>
                              setMembers((current) =>
                                current.filter((item) => item.id !== member.id),
                              ),
                            );
                        }}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </main>
    </ApplicationShell>
  );
}
