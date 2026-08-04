"""SQLAlchemy registry for projects, snapshots, uploads, builds, and audit."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    selectinload,
)

from app.models.project import UploadFileDeclaration


class ProjectsBase(DeclarativeBase):
    pass


class ProjectNotFound(KeyError):
    pass


class ProjectConflict(RuntimeError):
    pass


class UploadNotFound(KeyError):
    pass


class ProjectRow(ProjectsBase):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000))
    state: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    creator_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    creator_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active_snapshot_id: Mapped[str | None] = mapped_column(String(36))
    active_graph_version: Mapped[str | None] = mapped_column(String(128))
    active_document_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    generation: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    snapshots: Mapped[list[SnapshotRow]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )
    builds: Mapped[list[BuildJobRow]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )


class SnapshotRow(ProjectsBase):
    __tablename__ = "project_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    project: Mapped[ProjectRow] = relationship(back_populates="snapshots")
    files: Mapped[list[SnapshotFileRow]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan", lazy="selectin"
    )


class BlobRow(ProjectsBase):
    __tablename__ = "content_blobs"

    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class SnapshotFileRow(ProjectsBase):
    __tablename__ = "snapshot_files"
    __table_args__ = (UniqueConstraint("snapshot_id", "logical_filename"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("project_snapshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    logical_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot: Mapped[SnapshotRow] = relationship(back_populates="files")


class UploadSessionRow(ProjectsBase):
    __tablename__ = "upload_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("project_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    parts: Mapped[list[UploadPartRow]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )


class UploadPartRow(ProjectsBase):
    __tablename__ = "upload_parts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("upload_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    expected_size: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    temp_path: Mapped[str | None] = mapped_column(Text)
    received_size: Mapped[int | None] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    session: Mapped[UploadSessionRow] = relationship(back_populates="parts")


class BuildJobRow(ProjectsBase):
    __tablename__ = "build_jobs"
    __table_args__ = (Index("ix_build_jobs_status_created", "status", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("project_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(255), nullable=False)
    expected_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_version: Mapped[str | None] = mapped_column(String(128))
    error_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worker_id: Mapped[str | None] = mapped_column(String(128))
    project: Mapped[ProjectRow] = relationship(back_populates="builds")


class IdempotencyRow(ProjectsBase):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("actor_subject", "operation", "key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    operation: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class AuditEventRow(ProjectsBase):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


@dataclass(frozen=True)
class PartRecord:
    id: str
    session_id: str
    project_id: str
    snapshot_id: str
    filename: str
    media_type: str
    expected_size: int
    expected_sha256: str
    state: str
    temp_path: str | None
    expires_at: datetime


@dataclass(frozen=True)
class BuildRecord:
    id: str
    project_id: str
    snapshot_id: str
    expected_generation: int
    requested_by: str


def aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class ProjectRepository:
    def __init__(self, database_url: str, *, upload_ttl_hours: int = 24) -> None:
        self._engine: AsyncEngine = create_async_engine(
            database_url, pool_pre_ping=True
        )
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._upload_ttl = timedelta(hours=upload_ttl_hours)

    async def initialize(self) -> None:
        async with self._engine.begin() as connection:
            if self._engine.dialect.name == "sqlite":
                await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            await connection.run_sync(ProjectsBase.metadata.create_all)

    async def recover_builds(self) -> None:
        async with self._sessions.begin() as session:
            project_ids = list(
                (
                    await session.scalars(
                        select(BuildJobRow.project_id).where(
                            BuildJobRow.status == "building"
                        )
                    )
                ).all()
            )
            await session.execute(
                update(BuildJobRow)
                .where(BuildJobRow.status == "building")
                .values(status="queued", started_at=None, worker_id=None)
            )
            if project_ids:
                await session.execute(
                    update(ProjectRow)
                    .where(ProjectRow.id.in_(project_ids))
                    .values(state="queued")
                )

    async def close(self) -> None:
        await self._engine.dispose()

    async def list_projects(self) -> list[ProjectRow]:
        async with self._sessions() as session:
            return list(
                (
                    await session.scalars(
                        select(ProjectRow)
                        .where(ProjectRow.state != "archived")
                        .options(
                            selectinload(ProjectRow.snapshots),
                            selectinload(ProjectRow.builds),
                        )
                        .order_by(ProjectRow.updated_at.desc())
                    )
                ).all()
            )

    async def get_project(
        self, project_id: str, *, include_archived: bool = True
    ) -> ProjectRow:
        async with self._sessions() as session:
            statement = (
                select(ProjectRow)
                .where(ProjectRow.id == project_id)
                .options(
                    selectinload(ProjectRow.snapshots).selectinload(SnapshotRow.files),
                    selectinload(ProjectRow.builds),
                )
            )
            if not include_archived:
                statement = statement.where(ProjectRow.state != "archived")
            row = await session.scalar(statement)
            if row is None:
                raise ProjectNotFound(project_id)
            return row

    async def create_project(
        self,
        *,
        name: str,
        description: str | None,
        subject: str,
        username: str,
        key: str,
    ) -> ProjectRow:
        prior = await self._idempotent_resource(subject, "create_project", key)
        if prior:
            return await self.get_project(prior)
        now = datetime.now(UTC)
        project_id = str(uuid4())
        snapshot_id = str(uuid4())
        async with self._sessions.begin() as session:
            session.add(
                ProjectRow(
                    id=project_id,
                    name=name,
                    description=description,
                    state="draft",
                    creator_subject=subject,
                    creator_name=username,
                    created_at=now,
                    updated_at=now,
                    active_document_count=0,
                    generation=0,
                )
            )
            session.add(
                SnapshotRow(
                    id=snapshot_id,
                    project_id=project_id,
                    status="editable",
                    created_at=now,
                )
            )
            self._remember(session, subject, "create_project", key, project_id, now)
            self._audit(session, project_id, subject, "project.created", now)
        return await self.get_project(project_id)

    async def create_upload_session(
        self,
        project_id: str,
        declarations: list[UploadFileDeclaration],
        *,
        subject: str,
        key: str,
    ) -> UploadSessionRow:
        operation = f"create_upload_session:{project_id}"
        prior = await self._idempotent_resource(subject, operation, key)
        if prior:
            return await self.get_upload_session(project_id, prior)
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            if project.state in {"queued", "building", "archived"}:
                raise ProjectConflict("The project draft is not editable")
            draft = await self._draft(session, project_id)
            session_id = str(uuid4())
            row = UploadSessionRow(
                id=session_id,
                project_id=project_id,
                snapshot_id=draft.id,
                created_by=subject,
                state="open",
                created_at=now,
                expires_at=now + self._upload_ttl,
            )
            session.add(row)
            for declaration in declarations:
                session.add(
                    UploadPartRow(
                        id=str(uuid4()),
                        session_id=session_id,
                        logical_filename=declaration.filename,
                        media_type=declaration.media_type,
                        expected_size=declaration.size,
                        expected_sha256=declaration.sha256,
                        state="pending",
                    )
                )
            self._remember(session, subject, operation, key, session_id, now)
            self._audit(session, project_id, subject, "upload.created", now)
        return await self.get_upload_session(project_id, session_id)

    async def get_upload_session(
        self, project_id: str, session_id: str
    ) -> UploadSessionRow:
        async with self._sessions() as session:
            row = await session.scalar(
                select(UploadSessionRow)
                .where(
                    UploadSessionRow.id == session_id,
                    UploadSessionRow.project_id == project_id,
                )
                .options(selectinload(UploadSessionRow.parts))
            )
            if row is None:
                raise UploadNotFound(session_id)
            return row

    async def get_part(
        self, project_id: str, session_id: str, part_id: str
    ) -> PartRecord:
        upload = await self.get_upload_session(project_id, session_id)
        part = next((item for item in upload.parts if item.id == part_id), None)
        if part is None:
            raise UploadNotFound(part_id)
        return PartRecord(
            part.id,
            upload.id,
            upload.project_id,
            upload.snapshot_id,
            part.logical_filename,
            part.media_type,
            part.expected_size,
            part.expected_sha256,
            part.state,
            part.temp_path,
            aware(upload.expires_at) or upload.expires_at,
        )

    async def mark_part_uploaded(self, part_id: str, temp_path: str, size: int) -> None:
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(UploadPartRow)
                .where(UploadPartRow.id == part_id, UploadPartRow.state == "pending")
                .values(state="uploaded", temp_path=temp_path, received_size=size)
            )
            if not cast(CursorResult[Any], result).rowcount:
                raise ProjectConflict("The upload part is no longer writable")

    async def finalize_upload(
        self,
        project_id: str,
        session_id: str,
        blobs: list[tuple[str, str]],
        *,
        subject: str,
        key: str,
    ) -> list[SnapshotFileRow]:
        operation = f"finalize_upload:{session_id}"
        prior = await self._idempotent_resource(subject, operation, key)
        if prior:
            return await self.list_files(project_id)
        now = datetime.now(UTC)
        blob_paths = dict(blobs)
        async with self._sessions.begin() as session:
            upload = await session.scalar(
                select(UploadSessionRow)
                .where(
                    UploadSessionRow.id == session_id,
                    UploadSessionRow.project_id == project_id,
                )
                .options(selectinload(UploadSessionRow.parts))
            )
            if upload is None:
                raise UploadNotFound(session_id)
            if (
                upload.state != "open"
                or (aware(upload.expires_at) or upload.expires_at) <= now
            ):
                raise ProjectConflict("The upload session is not open")
            project = await self._project_for_update(session, project_id)
            if project.state in {"queued", "building", "archived"}:
                raise ProjectConflict("The project draft is not editable")
            if any(part.state != "uploaded" for part in upload.parts):
                raise ProjectConflict("All upload parts must be uploaded")
            for part in upload.parts:
                path = blob_paths.get(part.id)
                if path is None:
                    raise ProjectConflict("Upload validation is incomplete")
                existing_blob = await session.get(
                    BlobRow, (project_id, part.expected_sha256)
                )
                if existing_blob is None:
                    session.add(
                        BlobRow(
                            project_id=project_id,
                            sha256=part.expected_sha256,
                            size=part.expected_size,
                            storage_path=path,
                            created_at=now,
                        )
                    )
                await session.execute(
                    delete(SnapshotFileRow).where(
                        SnapshotFileRow.snapshot_id == upload.snapshot_id,
                        SnapshotFileRow.logical_filename == part.logical_filename,
                    )
                )
                session.add(
                    SnapshotFileRow(
                        id=str(uuid4()),
                        snapshot_id=upload.snapshot_id,
                        project_id=project_id,
                        logical_filename=part.logical_filename,
                        media_type=part.media_type,
                        size=part.expected_size,
                        sha256=part.expected_sha256,
                    )
                )
            upload.state = "finalized"
            project.updated_at = now
            self._remember(session, subject, operation, key, session_id, now)
            self._audit(session, project_id, subject, "upload.finalized", now)
        return await self.list_files(project_id)

    async def list_files(self, project_id: str) -> list[SnapshotFileRow]:
        async with self._sessions() as session:
            draft = await self._draft(session, project_id)
            return list(
                (
                    await session.scalars(
                        select(SnapshotFileRow)
                        .where(SnapshotFileRow.snapshot_id == draft.id)
                        .order_by(SnapshotFileRow.logical_filename)
                    )
                ).all()
            )

    async def delete_file(self, project_id: str, file_id: str, subject: str) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            if project.state in {"queued", "building", "archived"}:
                raise ProjectConflict("The project draft is not editable")
            draft = await self._draft(session, project_id)
            result = await session.execute(
                delete(SnapshotFileRow).where(
                    SnapshotFileRow.id == file_id,
                    SnapshotFileRow.snapshot_id == draft.id,
                )
            )
            if not cast(CursorResult[Any], result).rowcount:
                raise UploadNotFound(file_id)
            project.updated_at = now
            self._audit(session, project_id, subject, "draft.file_deleted", now)

    async def submit_build(
        self, project_id: str, *, subject: str, key: str
    ) -> BuildJobRow:
        operation = f"submit_build:{project_id}"
        prior = await self._idempotent_resource(subject, operation, key)
        if prior:
            return await self.get_build(project_id, prior)
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            if project.state in {"queued", "building", "archived"}:
                raise ProjectConflict("A build cannot be started")
            draft = await self._draft(session, project_id)
            open_uploads = await session.scalar(
                select(func.count())
                .select_from(UploadSessionRow)
                .where(
                    UploadSessionRow.project_id == project_id,
                    UploadSessionRow.snapshot_id == draft.id,
                    UploadSessionRow.state == "open",
                )
            )
            if open_uploads:
                raise ProjectConflict("Open upload sessions must be finalized first")
            count = await session.scalar(
                select(func.count())
                .select_from(SnapshotFileRow)
                .where(SnapshotFileRow.snapshot_id == draft.id)
            )
            if not count:
                raise ProjectConflict("At least one draft file is required")
            build_id = str(uuid4())
            row = BuildJobRow(
                id=build_id,
                project_id=project_id,
                snapshot_id=draft.id,
                status="queued",
                requested_by=subject,
                expected_generation=project.generation,
                created_at=now,
            )
            session.add(row)
            draft.status = "sealed"
            draft.sealed_at = now
            project.state = "queued"
            project.updated_at = now
            self._remember(session, subject, operation, key, build_id, now)
            self._audit(session, project_id, subject, "build.queued", now)
        return await self.get_build(project_id, build_id)

    async def get_build(self, project_id: str, build_id: str) -> BuildJobRow:
        async with self._sessions() as session:
            row = await session.scalar(
                select(BuildJobRow).where(
                    BuildJobRow.id == build_id, BuildJobRow.project_id == project_id
                )
            )
            if row is None:
                raise ProjectNotFound(build_id)
            return row

    async def claim_build(self, worker_id: str) -> BuildRecord | None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            building = await session.scalar(
                select(func.count())
                .select_from(BuildJobRow)
                .where(BuildJobRow.status == "building")
            )
            if building:
                return None
            row = await session.scalar(
                select(BuildJobRow)
                .where(BuildJobRow.status == "queued")
                .order_by(BuildJobRow.created_at)
                .limit(1)
            )
            if row is None:
                return None
            result = await session.execute(
                update(BuildJobRow)
                .where(BuildJobRow.id == row.id, BuildJobRow.status == "queued")
                .values(status="building", started_at=now, worker_id=worker_id)
            )
            if not cast(CursorResult[Any], result).rowcount:
                return None
            await session.execute(
                update(ProjectRow)
                .where(ProjectRow.id == row.project_id)
                .values(state="building", updated_at=now)
            )
            return BuildRecord(
                row.id,
                row.project_id,
                row.snapshot_id,
                row.expected_generation,
                row.requested_by,
            )

    async def snapshot_files(
        self, snapshot_id: str
    ) -> list[tuple[SnapshotFileRow, str]]:
        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(SnapshotFileRow, BlobRow.storage_path)
                    .join(
                        BlobRow,
                        (BlobRow.project_id == SnapshotFileRow.project_id)
                        & (BlobRow.sha256 == SnapshotFileRow.sha256),
                    )
                    .where(SnapshotFileRow.snapshot_id == snapshot_id)
                    .order_by(SnapshotFileRow.logical_filename)
                )
            ).all()
            return [(row, path) for row, path in rows]

    async def complete_build(
        self, build: BuildRecord, graph_version: str, document_count: int
    ) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, build.project_id)
            if project.generation != build.expected_generation:
                raise ProjectConflict("The active project generation changed")
            job = await session.get(BuildJobRow, build.id)
            snapshot = await session.get(SnapshotRow, build.snapshot_id)
            if job is None or snapshot is None or job.status != "building":
                raise ProjectConflict("The build is no longer active")
            await session.execute(
                update(SnapshotRow)
                .where(
                    SnapshotRow.project_id == project.id,
                    SnapshotRow.status == "active",
                )
                .values(status="validated")
            )
            snapshot.status = "active"
            project.active_snapshot_id = snapshot.id
            project.active_graph_version = graph_version
            project.active_document_count = document_count
            project.generation += 1
            project.state = "ready"
            project.updated_at = now
            job.status = "ready"
            job.graph_version = graph_version
            job.completed_at = now
            new_draft = SnapshotRow(
                id=str(uuid4()),
                project_id=project.id,
                status="editable",
                created_at=now,
            )
            session.add(new_draft)
            await session.flush()
            source_files = list(
                (
                    await session.scalars(
                        select(SnapshotFileRow).where(
                            SnapshotFileRow.snapshot_id == snapshot.id
                        )
                    )
                ).all()
            )
            for item in source_files:
                session.add(
                    SnapshotFileRow(
                        id=str(uuid4()),
                        snapshot_id=new_draft.id,
                        project_id=project.id,
                        logical_filename=item.logical_filename,
                        media_type=item.media_type,
                        size=item.size,
                        sha256=item.sha256,
                    )
                )
            self._audit(
                session,
                project.id,
                build.requested_by,
                "build.activated",
                now,
                {"graphVersion": graph_version},
            )

    async def fail_build(self, build: BuildRecord, error_code: str) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            job = await session.get(BuildJobRow, build.id)
            snapshot = await session.get(SnapshotRow, build.snapshot_id)
            project = await self._project_for_update(session, build.project_id)
            if job is not None:
                job.status = "failed"
                job.error_code = error_code
                job.completed_at = now
            if snapshot is not None:
                snapshot.status = "editable"
                snapshot.sealed_at = None
            project.state = "ready" if project.active_graph_version else "failed"
            project.updated_at = now
            self._audit(
                session,
                project.id,
                build.requested_by,
                "build.failed",
                now,
                {"errorCode": error_code},
            )

    async def archive(self, project_id: str, subject: str) -> ProjectRow:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            if project.state in {"queued", "building"}:
                raise ProjectConflict("A building project cannot be archived")
            project.state = "archived"
            project.archived_at = now
            project.updated_at = now
            self._audit(session, project_id, subject, "project.archived", now)
        return await self.get_project(project_id)

    async def restore(
        self, project_id: str, subject: str, retention_days: int
    ) -> ProjectRow:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            archived_at = aware(project.archived_at)
            if project.state != "archived" or archived_at is None:
                raise ProjectConflict("The project is not archived")
            if archived_at < now - timedelta(days=retention_days):
                raise ProjectConflict("The project restore period expired")
            project.state = "ready" if project.active_graph_version else "draft"
            project.archived_at = None
            project.updated_at = now
            self._audit(session, project_id, subject, "project.restored", now)
        return await self.get_project(project_id)

    async def cleanup_expired_uploads(self) -> list[str]:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            rows = list(
                (
                    await session.scalars(
                        select(UploadPartRow)
                        .join(UploadSessionRow)
                        .where(
                            UploadSessionRow.state == "open",
                            UploadSessionRow.expires_at < now,
                        )
                    )
                ).all()
            )
            paths = [row.temp_path for row in rows if row.temp_path]
            await session.execute(
                update(UploadSessionRow)
                .where(
                    UploadSessionRow.state == "open", UploadSessionRow.expires_at < now
                )
                .values(state="expired")
            )
            return paths

    async def purge_expired(
        self, project_id: str, subject: str, retention_days: int
    ) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            project = await self._project_for_update(session, project_id)
            archived_at = aware(project.archived_at)
            if (
                project.state != "archived"
                or archived_at is None
                or archived_at > now - timedelta(days=retention_days)
            ):
                raise ProjectConflict("The archived project is still retained")
            self._audit(session, project_id, subject, "project.purged", now)
            await session.execute(
                delete(BlobRow).where(BlobRow.project_id == project_id)
            )
            await session.execute(delete(ProjectRow).where(ProjectRow.id == project_id))

    async def expired_archives(self, retention_days: int) -> list[str]:
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        async with self._sessions() as session:
            return list(
                (
                    await session.scalars(
                        select(ProjectRow.id).where(
                            ProjectRow.state == "archived",
                            ProjectRow.archived_at <= cutoff,
                        )
                    )
                ).all()
            )

    async def _idempotent_resource(
        self, actor: str, operation: str, key: str
    ) -> str | None:
        async with self._sessions() as session:
            return cast(
                str | None,
                await session.scalar(
                    select(IdempotencyRow.resource_id).where(
                        IdempotencyRow.actor_subject == actor,
                        IdempotencyRow.operation == operation,
                        IdempotencyRow.key == key,
                    )
                ),
            )

    @staticmethod
    def _remember(
        session: AsyncSession,
        actor: str,
        operation: str,
        key: str,
        resource_id: str,
        now: datetime,
    ) -> None:
        session.add(
            IdempotencyRow(
                id=str(uuid4()),
                actor_subject=actor,
                operation=operation,
                key=key,
                resource_id=resource_id,
                created_at=now,
            )
        )

    @staticmethod
    def _audit(
        session: AsyncSession,
        project_id: str,
        actor: str,
        action: str,
        now: datetime,
        details: dict[str, Any] | None = None,
    ) -> None:
        session.add(
            AuditEventRow(
                id=str(uuid4()),
                project_id=project_id,
                actor_subject=actor,
                action=action,
                occurred_at=now,
                details=details or {},
            )
        )

    @staticmethod
    async def _project_for_update(session: AsyncSession, project_id: str) -> ProjectRow:
        row = await session.scalar(
            select(ProjectRow).where(ProjectRow.id == project_id).with_for_update()
        )
        if row is None:
            raise ProjectNotFound(project_id)
        return row

    @staticmethod
    async def _draft(session: AsyncSession, project_id: str) -> SnapshotRow:
        row = await session.scalar(
            select(SnapshotRow)
            .where(
                SnapshotRow.project_id == project_id, SnapshotRow.status == "editable"
            )
            .order_by(SnapshotRow.created_at.desc())
            .limit(1)
        )
        if row is None:
            raise ProjectConflict("The project has no editable draft")
        return row
