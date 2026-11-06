# Terraform AWS Relationship Explorer — Continuation Guide

## Project purpose and status

This repository contains a static, browser-based prototype for interactively exploring AWS Terraform managed resources and observed resource-to-resource references. It can run locally or in a Docker container. It is not currently a production service: there is no authentication, server-side persistence, shared database, or production AWS/ECS deployment.

The original scope and product intent are recorded in [`plan-for-terraform-explorer.md`](./plan-for-terraform-explorer.md). The follow-on feature plan is [`update-plan-1.md`](./update-plan-1.md); its listed branching, Clean mode, and SVG map export work has been implemented.

## Completed functionality

- Search and interactive relationship graph with a dark VS Code Abyss-inspired palette, resource history, saved/reorderable mappings, pan/zoom, and draggable nodes.
- Top-down dependency exploration, including observed incoming prerequisites above the searched resource; expanding dependant categories; collision-aware positioning; collapsible groups; and minimized same-level siblings.
- Multi-branch selection from shared resources, with shared graph nodes deduplicated.
- Clean mode, which shows selected resources and relationships without category cards or unselected candidates.
- Terraform export preview with configurable provider-schema fields, `"REQUIRED"` placeholders, optional `null` placeholders, syntax highlighting, copy, and `.tf` download. Selected branches are included.
- SVG map export preview with top-down and left-to-right layouts and download.
- Selected-node controls: the main area focuses a selected branch; the red-tinted right quarter containing × deselects it. Keyboard activation is supported, and branch/category state is retained while focusing another branch.
- README usage instructions and scripts to regenerate the relationship catalog.

## Repository layout and implementation

- [`index.html`](../index.html): app shell, controls, dialogs, panels, and accessibility labels.
- [`app.js`](../app.js): all browser application logic, data loading, state, SVG graph construction/rendering, selection, saved mappings, history, Terraform export, SVG export, and event handlers. There is no frontend framework or build pipeline.
- [`styles.css`](../styles.css): layout, graph visuals, modal styling, responsive behavior, and control states.
- [`data/relationships.json`](../data/relationships.json): resource nodes, relationship edges, provenance, confidence, and generation metadata.
- [`data/configuration-fields.json`](../data/configuration-fields.json): configurable provider-schema fields used by Terraform export.
- [`scripts/generate_relationships.py`](../scripts/generate_relationships.py): extracts resource references from module HCL and combines them with the provider schema and existing curated catalog.
- [`scripts/fetch_public_modules.sh`](../scripts/fetch_public_modules.sh): fetches public AWS Terraform modules for catalog generation.
- [`tools/provider-schema/`](../tools/provider-schema): Terraform configuration and lock file for obtaining the pinned HashiCorp AWS provider schema.
- [`tests/test_generate_relationships.py`](../tests/test_generate_relationships.py): Python unit tests for catalog generation and schema behavior.
- [`Dockerfile`](../Dockerfile): static-site container setup.
- [`README.md`](../README.md): current authoritative run instructions, feature guide, regeneration workflow, and caveats.
- [`shortcomings-and-to-improve.md`](./shortcomings-and-to-improve.md): user's stated concerns and longer-term improvement areas.
- [`conversation-history.md`](./conversation-history.md): detailed record of requests and implemented responses.

There is no `package.json` or JavaScript dependency installation/build step. Browser JavaScript runs directly from the static app.

## Important state and interaction model

In `app.js`, the central `state` object contains:

- `resources` and `relationships`: loaded graph data.
- `focus` and `path`: current active resource and root-to-focus route.
- `selectedEdges`: selected branches beyond the active route. The complete selected graph is the union of these edges and the current path edges.
- `expanded`: category/group expansion keys.
- `positions`, `cleanMode`, zoom/pan values, and saved mapping/history state.

This distinction between active `path` and `selectedEdges` matters: switching focus must not discard sibling branches. Relevant functions include `selectDependent`, `deselectResource`, `activateSelectedResource`, `selectedGraph`, `renderCleanGraph`, `renderGraph`, and `createBubble`. Saved maps and recent history use browser `localStorage` keys `terraform-explorer.saved` and `terraform-explorer.history`.

When changing graph behavior, check all related surfaces: normal and Clean graph modes, selected path and branches, category expansion, save/restore, Terraform export, SVG export, mouse/drag handling, and keyboard/accessibility actions. A visual change to SVG nodes can affect graph hit-testing or drag behavior.

## Run and validate

From the repository root:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`; do not open `index.html` directly because the app fetches JSON data over HTTP. Alternatively, use the Docker commands in the README:

```sh
docker build -t terraform-relationship-explorer .
docker run --rm -p 8080:80 terraform-relationship-explorer
```

Run the existing automated tests:

```sh
python3 -m unittest discover -s tests
```

Use browser interaction tests for frontend behavior (navigation, selection, exports, dialogs, and persisted mappings); the Python tests cover the generator, not the UI. Run `git diff --check` on the files changed for a task. At the time this guide was written, Python 3.9.6 was available and `node` was not found, so `node --check` was unavailable in this environment. Recheck tool availability rather than assuming it remains the same. A local HTTP server on port 8765 was used in prior browser validation; do not assume it is still running.

## Relationship data: provenance and limitations

The current dataset is reported as 1,506 managed resources and 400 relationship entries, based on HashiCorp AWS provider v6.0.0 and 31 public `terraform-aws-modules` repositories. Metadata records module revisions and relationship evidence. The graph excludes data sources and variables as nodes.

This is a best-effort, heuristic catalog, not a complete or authoritative Terraform dependency map. A required provider argument does not prove that another managed resource must supply its value. Relationships are inferred from references found in sampled public modules and may miss indirect module inputs/outputs, complex expressions, or unsupported HCL patterns. A sampled reference may not apply to a user's configuration. Terraform's actual dependency graph is configuration-specific and follows its expressions.

The generator uses regexes and custom HCL block/comment/string handling rather than a full HCL parser; treat changes to extraction logic carefully and add focused tests. Re-running generation replaces generated edges while preserving curated examples. It records exact checked-out module commits. Follow the README regeneration instructions and inspect the resulting data diff before accepting a regeneration. Terraform and Git are required; the provider schema is pinned, and fetched modules live under the ignored `.cache/` directory. Do not fetch modules or change provider/module versions without a clear need.

## User workflow and decision preferences

- Keep changes surgical, understandable, and documented; avoid broad rewrites and unnecessary dependencies.
- For features described in the follow-on plan, the user asked to handle one feature at a time: explain viable approaches with strengths and weaknesses, then ask for their choice before starting implementation. Respect that for new planned features or significant behavior/architecture decisions; ordinary bug fixes explicitly requested by the user can proceed directly.
- The user's stated longer-term concerns are relationship-data accuracy, choosing/understanding appropriate tools and processes, and making security a priority. See [`shortcomings-and-to-improve.md`](./shortcomings-and-to-improve.md). Do not imply that a security audit or production readiness assessment has been completed.
- When a request is ambiguous in a way that changes behavior or scope, ask before choosing. For implementation tasks, verify the requested behavior, not just that code builds.

## Current worktree and safe continuation

The worktree was already dirty during the latest UI work. At the time of writing, `git status --short` showed modifications in `app.js`, `styles.css`, `index.html`, `README.md`, and `Plans-and-Skills/update-plan-1.md`, plus untracked `Plans-and-Skills/shortcomings-and-to-improve.md` and this summary. Some changes predate this summary and may belong to the user or earlier work.

Before any further edit, run `git status --short` and inspect the relevant diff. Do not reset, revert, overwrite, or stage unrelated changes. In particular, do not clean up trailing whitespace from `update-plan-1.md` as part of an unrelated task; a previous full `git diff --check` reported existing whitespace there, while the latest task-related files passed.

## Recent work and test record

The latest UI fix separated focus from deselection on selected nodes and preserved branch/category state when switching focus. Browser testing confirmed selected branches remained selected while changing focus, and keyboard activation of the × removed only the targeted resource while retaining the other reachable selections. At that point, `python3 -m unittest discover -s tests` passed all 6 tests, and `git diff --check -- README.md app.js styles.css` passed. These are historical results; rerun relevant tests after changes.
