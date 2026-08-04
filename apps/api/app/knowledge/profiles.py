"""Trusted, versioned structural profiles for source documents."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

TOKENIZER_ENCODING = "o200k_base"
SPLITTER_SCHEMA_VERSION = "structural-v1"
HAYSTACK_VERSION = "2.31.0"
PROFILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class DocumentProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    hard_boundaries: tuple[
        Literal["page", "markdown_heading", "legal_article"], ...
    ] = Field(alias="hardBoundaries", min_length=1)
    leaf_tokens: int = Field(alias="leafTokens", ge=64, le=4095)
    parent_tokens: int = Field(alias="parentTokens", ge=65, le=4096)
    overlap_tokens: int = Field(alias="overlapTokens", ge=0)
    auto_merge_threshold: float = Field(alias="autoMergeThreshold", gt=0, lt=1)

    @model_validator(mode="after")
    def valid_sizes(self) -> DocumentProfile:
        if self.leaf_tokens >= self.parent_tokens:
            raise ValueError("leafTokens must be less than parentTokens")
        if self.overlap_tokens >= self.leaf_tokens:
            raise ValueError("overlapTokens must be less than leafTokens")
        if len(set(self.hard_boundaries)) != len(self.hard_boundaries):
            raise ValueError("hardBoundaries must not contain duplicates")
        return self


class ProfileRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    glob: str = Field(min_length=1, max_length=512)
    profile: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def safe_values(self) -> ProfileRule:
        if not PROFILE_NAME.fullmatch(self.profile):
            raise ValueError("Rule profile name is invalid")
        if self.glob.startswith("/") or ".." in self.glob.split("/"):
            raise ValueError("Rule glob must be a safe relative POSIX pattern")
        if "\\" in self.glob:
            raise ValueError("Rule glob must use POSIX separators")
        return self


class DocumentProfiles(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: Literal[1]
    default_profile: str = Field(alias="defaultProfile", min_length=1, max_length=64)
    rules: tuple[ProfileRule, ...] = ()
    profiles: dict[str, DocumentProfile]

    @model_validator(mode="after")
    def valid_references(self) -> DocumentProfiles:
        if not PROFILE_NAME.fullmatch(self.default_profile):
            raise ValueError("defaultProfile is invalid")
        for name in self.profiles:
            if not PROFILE_NAME.fullmatch(name):
                raise ValueError(f"Profile name is invalid: {name}")
        if self.default_profile not in self.profiles:
            raise ValueError("defaultProfile does not reference a profile")
        globs: set[str] = set()
        for rule in self.rules:
            if rule.profile not in self.profiles:
                raise ValueError(f"Rule references unknown profile: {rule.profile}")
            if rule.glob in globs:
                raise ValueError("Profile rules must be unique")
            globs.add(rule.glob)
        return self

    def select(self, relative_path: str) -> tuple[str, DocumentProfile]:
        for rule in self.rules:
            if PurePosixPath(relative_path).match(rule.glob):
                return rule.profile, self.profiles[rule.profile]
        return self.default_profile, self.profiles[self.default_profile]

    def canonical_json(self) -> str:
        return json.dumps(
            self.model_dump(mode="json", by_alias=True),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def processing_fingerprint(self) -> str:
        payload = {
            "profiles": json.loads(self.canonical_json()),
            "converterSplitterSchema": SPLITTER_SCHEMA_VERSION,
            "haystackVersion": HAYSTACK_VERSION,
            "tokenizerEncoding": TOKENIZER_ENCODING,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


DEFAULT_DOCUMENT_PROFILES = {
    "version": 1,
    "defaultProfile": "generic",
    "rules": [
        {"glob": "ley-*.md", "profile": "legal-es"},
        {"glob": "resoluci*.md", "profile": "legal-es"},
    ],
    "profiles": {
        "generic": {
            "hardBoundaries": ["page", "markdown_heading"],
            "leafTokens": 256,
            "parentTokens": 768,
            "overlapTokens": 32,
            "autoMergeThreshold": 0.5,
        },
        "legal-es": {
            "hardBoundaries": ["page", "legal_article", "markdown_heading"],
            "leafTokens": 256,
            "parentTokens": 768,
            "overlapTokens": 32,
            "autoMergeThreshold": 0.5,
        },
    },
}
DEFAULT_DOCUMENT_PROFILES_JSON = json.dumps(
    DEFAULT_DOCUMENT_PROFILES, separators=(",", ":")
)


def parse_document_profiles(value: str) -> DocumentProfiles:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("KNOWLEDGE_DOCUMENT_PROFILES_JSON is invalid JSON") from exc
    return DocumentProfiles.model_validate(parsed)
