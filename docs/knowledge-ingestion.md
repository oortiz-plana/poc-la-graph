# Knowledge ingestion

The ingestion service accepts `.md`, `.txt`, `.html`/`.htm`, `.pdf`, and
`.docx` files. Discovery is deterministic, does not follow symlinks, applies
count/per-file/aggregate byte limits, and calculates SHA-256 over each original
file. Graphify receives a byte-for-byte staging copy. The source index receives
normalized extracted text plus the source media type, structural profile, and
converter provenance.

Markdown and text require strict UTF-8. HTML extraction is local and never
fetches links or resources. PDFs require a valid, unencrypted embedded text
layer; OCR is not performed. DOCX containers are checked for unsafe ZIP paths,
duplicate entries, excessive expansion, and suspicious compression ratios.
Malformed, empty, or over-limit conversions fail the complete build.

## Structural profiles

`KNOWLEDGE_DOCUMENT_PROFILES_JSON` is trusted operator configuration. It has a
versioned schema with ordered, case-sensitive POSIX path rules:

```json
{
  "version": 1,
  "defaultProfile": "generic",
  "rules": [{"glob": "ley-*.md", "profile": "legal-es"}],
  "profiles": {
    "generic": {
      "hardBoundaries": ["page", "markdown_heading"],
      "leafTokens": 256,
      "parentTokens": 768,
      "overlapTokens": 32,
      "autoMergeThreshold": 0.5
    },
    "legal-es": {
      "hardBoundaries": ["page", "legal_article", "markdown_heading"],
      "leafTokens": 256,
      "parentTokens": 768,
      "overlapTokens": 32,
      "autoMergeThreshold": 0.5
    }
  }
}
```

Only `page`, `markdown_heading`, and `legal_article` are accepted boundaries.
The first matching rule wins. Profile references and unique rules are checked
at process startup, with `64 <= leafTokens < parentTokens <= 4096`,
`0 <= overlapTokens < leafTokens`, and `0 < autoMergeThreshold < 1`.

Structural blocks never cross configured boundaries. Blocks within the leaf
limit are standalone searchable leaves. Larger blocks become parents capped at
the parent limit and overlapping searchable children capped at the leaf limit.
Parents are durable but are not indexed in FTS5. Retrieval ranks only a
document/article allowlisted slice, then Haystack `AutoMergingRetriever`
reconstructs at most one bounded parent when the strict matched-child ratio is
greater than the configured threshold.

The processing fingerprint covers canonical profile JSON, the conversion and
splitter schema, Haystack `2.31.0`, and the `o200k_base` tokenizer. It is stored
in the ingestion manifest and index. A changed fingerprint prevents the
unchanged-source skip path.

## Atomic lifecycle

The versioned SQLite index stores parents and leaves with deterministic IDs,
normalized-text line and character offsets, token count, media type, profile,
page, heading path, article, and paragraph metadata. Existing flat rows are
migrated in place and remain readable.

Graphify writes `output/graphify-out/graph.json`. The service validates the
artifact and builds the source-index version before atomically replacing the
`/knowledge/graph/active` symlink and manifest. Conversion, profile, graph, or
index failures leave the previous graph/index version active.

At least two graph versions are retained. Failed staging trees are moved to
`/knowledge/failed/<id>`. A POSIX `flock` prevents concurrent ingestion and
rollback.

## Commands

```bash
make knowledge-ingest
make knowledge-rebuild
make knowledge-status
make test-graphify-real
make smoke-spanish
```

Graphify extraction requires `OPENAI_API_KEY` and optionally
`OPENAI_MODEL`/`OPENAI_BASE_URL`. The unauthenticated administration endpoint
is a development-only POC operation and is disabled with
`KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED=false`.
