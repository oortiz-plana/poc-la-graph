# Future Upload and Permission Boundary

Uploads are deliberately not implemented in the unauthenticated POC. This
contract prevents a later upload feature from weakening the query boundary.

## Service abstraction

```python
class KnowledgeIngestionService(Protocol):
    async def create_source_snapshot(
        self, project_id: str, actor: Actor, declaration: SourceDeclaration
    ) -> UploadSession: ...
    async def finalize_snapshot(
        self, session_id: str, actor: Actor, checksum: str
    ) -> BuildJob: ...
    async def get_job(self, job_id: str, actor: Actor) -> BuildJob: ...
    async def activate(
        self, project_id: str, graph_version: str,
        expected_generation: int, actor: Actor
    ) -> ActivationResult: ...
    async def rollback(
        self, project_id: str, target_version: str,
        expected_generation: int, actor: Actor
    ) -> ActivationResult: ...
```

Storage drivers (local staging, object storage, repository snapshot) implement
an internal blob interface. They return opaque object identifiers, never paths
accepted from the browser. Build workers resolve identifiers through the
storage driver.

## Permissions

| Permission | Capability |
|---|---|
| `knowledge.read` | inspect versions and job status |
| `knowledge.upload` | create/finalize source snapshots |
| `knowledge.build` | request a build from a finalized snapshot |
| `knowledge.activate` | atomically select a validated version |
| `knowledge.rollback` | select a prior validated version |
| `knowledge.delete` | apply retention to inactive, unprotected versions |

Project scope is mandatory for every permission. Upload does not imply
activation. Service credentials used by the chat API have `knowledge.read`
only. Build workers can write a new version but cannot activate it. The
activator cannot modify version contents.

## Input contract

The future public API should accept metadata plus streamed bytes or a
pre-authorized upload, not a server filesystem path or URL for the backend to
fetch. At minimum:

- project ID resolved against authorization;
- media type and declared uncompressed size;
- SHA-256 supplied at finalization and verified server-side;
- source kind and immutable source version;
- idempotency key;
- optional activation request evaluated separately.

Arbitrary remote URLs, Git credentials, Graphify tool names, graph version IDs,
and output paths are never model-generated inputs. Repository import, if added,
uses a configured connector with scoped credentials and an allowlisted host.

## Audit

Record actor, project, request/job/version IDs, source checksum, permission
decision, state transitions, activation generations, previous/target versions,
and failure category. Do not log source content, credentials, signed upload
URLs, or proprietary filenames beyond policy-approved metadata.
