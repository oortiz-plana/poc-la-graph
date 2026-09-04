"""Deterministic synthetic PL/SQL corpus for development and tests.

The corpus mirrors the semantic-graph record shape consumed from the
`plsqlgraph` pipeline. Names and source files are minimal synthetic fixtures
created for this repository; they never contain proprietary code.
"""

from __future__ import annotations

from app.integrations.plsql.models import (
    PlsqlDependencyRecord,
    PlsqlEvidence,
    PlsqlObjectRecord,
)
from app.models.plsql import ObjectKind, PlsqlRelationship, PlsqlResolution


def _record(
    project_id: str,
    *,
    kind: ObjectKind,
    name: str,
    owner: str | None = None,
    signature: str | None = None,
    return_type: str | None = None,
    path: str,
    line: int,
    column: int = 1,
) -> PlsqlObjectRecord:
    schema = "HR"
    qualified_name = ".".join(part for part in (schema, owner, name) if part)
    if owner is not None:
        id_parts = [project_id, schema, "PACKAGE", owner, _kind_token(kind), name]
    else:
        id_parts = [project_id, schema, _kind_token(kind), name]
    object_id = "plsql://" + "/".join(id_parts)
    return PlsqlObjectRecord(
        id=object_id,
        kind=kind,
        name=name,
        schema_name=schema,
        qualified_name=qualified_name,
        project_id=project_id,
        owner=owner,
        signature=signature,
        return_type=return_type,
        evidence=PlsqlEvidence(
            source_file_id=f"file://{project_id}/{path}",
            path=path,
            start_line=line,
            start_column=column,
        ),
    )


def _kind_token(kind: ObjectKind) -> str:
    return {
        "Table": "TABLE",
        "View": "VIEW",
        "Package": "PACKAGE",
        "Sequence": "SEQUENCE",
        "Trigger": "TRIGGER",
        "Index": "INDEX",
        "Synonym": "SYNONYM",
        "Type": "TYPE",
        "Procedure": "PROCEDURE",
        "Function": "FUNCTION",
        "AnonymousBlock": "ANONYMOUS_BLOCK",
    }[kind]


def build_corpus(project_id: str) -> list[PlsqlObjectRecord]:
    """Return the deterministic synthetic corpus for a project identifier."""
    return [
        _record(
            project_id,
            kind="Table",
            name="EMPLOYEES",
            path="hr/employees.sql",
            line=3,
        ),
        _record(
            project_id,
            kind="Table",
            name="DEPARTMENTS",
            path="hr/departments.sql",
            line=2,
        ),
        _record(
            project_id,
            kind="View",
            name="EMPLOYEE_DETAILS",
            path="hr/employee_details.sql",
            line=4,
        ),
        _record(
            project_id,
            kind="Package",
            name="PKG_EMPLOYEE",
            path="hr/pkg_employee.pks",
            line=1,
        ),
        _record(
            project_id,
            kind="Procedure",
            name="CREATE_EMPLOYEE",
            owner="PKG_EMPLOYEE",
            signature="VARCHAR2,NUMBER",
            path="hr/pkg_employee.pkb",
            line=7,
        ),
        _record(
            project_id,
            kind="Function",
            name="CALCULATE_BONUS",
            owner="PKG_EMPLOYEE",
            signature="NUMBER",
            return_type="NUMBER",
            path="hr/pkg_employee.pkb",
            line=21,
        ),
        _record(
            project_id,
            kind="Package",
            name="PKG_PAYROLL",
            path="hr/pkg_payroll.pks",
            line=1,
        ),
        _record(
            project_id,
            kind="Function",
            name="CALCULATE_MORA",
            owner="PKG_PAYROLL",
            signature="VARCHAR2",
            return_type="NUMBER",
            path="hr/pkg_payroll.pkb",
            line=9,
        ),
        _record(
            project_id,
            kind="Procedure",
            name="RUN_PAYROLL",
            owner="PKG_PAYROLL",
            path="hr/pkg_payroll.pkb",
            line=30,
        ),
        _record(
            project_id,
            kind="Procedure",
            name="ARCHIVE_EMPLOYEE",
            path="hr/archive_employee.sql",
            line=5,
        ),
        _record(
            project_id,
            kind="Function",
            name="COUNT_EMPLOYEES",
            return_type="NUMBER",
            path="hr/count_employees.sql",
            line=5,
        ),
        _record(
            project_id,
            kind="Trigger",
            name="TRG_EMPLOYEES_AUDIT",
            path="hr/trg_employees_audit.sql",
            line=2,
        ),
        _record(
            project_id,
            kind="Synonym",
            name="EMPLOYEE_ALIAS",
            path="hr/employee_alias.sql",
            line=1,
        ),
        _record(
            project_id,
            kind="Sequence",
            name="EMPLOYEE_SEQ",
            path="hr/employee_seq.sql",
            line=1,
        ),
        _record(
            project_id,
            kind="Type",
            name="EMPLOYEE_INFO",
            path="hr/employee_info.sql",
            line=1,
        ),
    ]


def build_edges(
    project_id: str, corpus: list[PlsqlObjectRecord] | None = None
) -> list[PlsqlDependencyRecord]:
    """Return deterministic typed dependency edges over the synthetic corpus.

    Only objects that appear in the corpus receive real endpoint references;
    unresolved placeholders (for example legacy routines outside the analyzed
    set) carry a stable fabricated identifier and an UNRESOLVED marker.
    """

    corpus = corpus if corpus is not None else build_corpus(project_id)
    by_qualified = {record.qualified_name.casefold(): record for record in corpus}
    edges: list[tuple[str, str, PlsqlRelationship, PlsqlResolution, str, int]] = [
        (
            "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
            "HR.EMPLOYEES",
            "WRITES",
            "EXACT",
            "hr/pkg_employee.pkb",
            12,
        ),
        (
            "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
            "HR.DEPARTMENTS",
            "READS",
            "EXACT",
            "hr/pkg_employee.pkb",
            15,
        ),
        (
            "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
            "HR.EMPLOYEES",
            "READS",
            "EXACT",
            "hr/pkg_employee.pkb",
            25,
        ),
        (
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
            "CALLS",
            "INFERRED",
            "hr/pkg_payroll.pkb",
            11,
        ),
        (
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.EMPLOYEES",
            "READS",
            "EXACT",
            "hr/pkg_payroll.pkb",
            13,
        ),
        (
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.COUNT_EMPLOYEES",
            "CALLS",
            "EXACT",
            "hr/pkg_payroll.pkb",
            16,
        ),
        (
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.PKG_LEGACY.RUN_UNKNOWN",
            "CALLS",
            "UNRESOLVED",
            "hr/pkg_payroll.pkb",
            40,
        ),
        (
            "HR.PKG_PAYROLL.RUN_PAYROLL",
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "CALLS",
            "EXACT",
            "hr/pkg_payroll.pkb",
            34,
        ),
        (
            "HR.PKG_PAYROLL.RUN_PAYROLL",
            "HR.DEPARTMENTS",
            "WRITES",
            "EXACT",
            "hr/pkg_payroll.pkb",
            36,
        ),
        (
            "HR.ARCHIVE_EMPLOYEE",
            "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
            "CALLS",
            "EXACT",
            "hr/archive_employee.sql",
            8,
        ),
        (
            "HR.TRG_EMPLOYEES_AUDIT",
            "HR.EMPLOYEES",
            "TRIGGER_ON",
            "EXACT",
            "hr/trg_employees_audit.sql",
            4,
        ),
        (
            "HR.EMPLOYEE_DETAILS",
            "HR.EMPLOYEES",
            "VIEW_DEPENDS_ON",
            "EXACT",
            "hr/employee_details.sql",
            6,
        ),
        (
            "HR.EMPLOYEE_DETAILS",
            "HR.DEPARTMENTS",
            "VIEW_DEPENDS_ON",
            "EXACT",
            "hr/employee_details.sql",
            7,
        ),
        (
            "HR.COUNT_EMPLOYEES",
            "HR.EMPLOYEES",
            "READS",
            "EXACT",
            "hr/count_employees.sql",
            6,
        ),
        # AMBIGUOUS sample: the same standalone routine also reads a view that
        # may resolve to several underlying tables; never presented as certain.
        (
            "HR.ARCHIVE_EMPLOYEE",
            "HR.EMPLOYEE_DETAILS",
            "READS",
            "AMBIGUOUS",
            "hr/archive_employee.sql",
            9,
        ),
    ]

    dependencies: list[PlsqlDependencyRecord] = []
    for source_q, target_q, relationship, resolution, path, line in edges:
        source = by_qualified[source_q.casefold()]
        target = by_qualified.get(target_q.casefold())
        if target is None:
            # Unresolved placeholder outside the analyzed corpus.
            schema = target_q.split(".", 1)[0]
            name = target_q.rsplit(".", 1)[-1]
            target = PlsqlObjectRecord(
                id=f"plsql://{project_id}/{target_q.replace('.', '/')}",
                kind="Procedure",
                name=name,
                schema_name=schema,
                qualified_name=target_q,
                project_id=project_id,
            )
        dependencies.append(
            PlsqlDependencyRecord(
                id=(
                    f"edge://{project_id}/{relationship}/"
                    f"{source.id.replace('://', '/')}/{target.id.replace('://', '/')}"
                ),
                relationship=relationship,
                resolution=resolution,
                source_id=source.id,
                source_kind=source.kind,
                source_name=source.name,
                source_qualified_name=source.qualified_name,
                target_id=target.id,
                target_kind=target.kind,
                target_name=target.name,
                target_qualified_name=target.qualified_name,
                evidence=PlsqlEvidence(
                    source_file_id=f"file://{project_id}/{path}",
                    path=path,
                    start_line=line,
                    start_column=1,
                ),
            )
        )
    return dependencies
