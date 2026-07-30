# ADR 0003: Bounded LangGraph workflow

Status: Accepted

## Context

An unconstrained model tool loop can access excess data, amplify prompt
injection, and produce unverifiable citations.

## Decision

Use explicit LangGraph nodes for validation, classification, planning, Graphify
query, bounded expansion, context preparation, generation, grounding validation,
and formatting. The model cannot select arbitrary tools or supply project paths.
Backend configuration caps all tool and evidence dimensions. Empty or inadequate
evidence produces an insufficient-evidence answer without invented facts.

## Consequences

The workflow is predictable and testable, at the cost of less open-ended
exploration. New tools require adapter changes, tests, and a contract decision.

