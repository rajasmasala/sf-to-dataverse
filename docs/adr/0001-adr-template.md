# ADR 0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

This repository spans three platforms (Salesforce, Azure Functions, Power
Platform) and four languages (Apex, JavaScript, C#, Power Fx). Decisions taken
in one platform — choice of async primitive, message broker, span processor,
idempotency strategy — have long half-lives and are easy to forget. A reviewer
six months from now, or a recruiter reading the repo cold, will ask "why this
and not the obvious alternative?" with no one around to answer.

## Decision

We record every architecturally significant decision as an Architecture
Decision Record (ADR) in this folder, following Michael Nygard's format
(https://adr.github.io/). Each ADR has:

- **Title** — numbered, zero-padded, imperative ("Use X over Y")
- **Context** — the forces at play, including constraints and alternatives
- **Decision** — what we chose and the one-sentence reason
- **Consequences** — what becomes easier, what becomes harder, what to watch for
- **Status** — `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNNN`

Filenames are `NNNN-kebab-case.md`, starting at `0001`. Append-only: superseding
a decision adds a new ADR with `Superseded by ADR-NNNN` and edits the old one's
status line — never delete.

## Consequences

- A reviewer can trace the reasoning behind any non-obvious design choice by
  reading at most two paragraphs per file.
- Adds a small documentation tax on every meaningful decision; we accept it
  because onboarding cost dwarfs it.
- ADRs that mention environment-specific names (publisher prefix, env vars)
  must be updated if those names change — they are not auto-generated.
