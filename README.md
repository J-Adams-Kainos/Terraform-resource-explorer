# Terraform AWS Relationship Explorer

A browser-based prototype for exploring AWS Terraform resources and observed resource-to-resource references. The app is static and needs no build step or runtime dependencies.

## Run locally

Build and run with Docker:

```sh
docker build -t terraform-relationship-explorer .
docker run --rm -p 8080:80 terraform-relationship-explorer
```

Open [http://localhost:8080](http://localhost:8080).

Alternatively, run `python3 -m http.server 8080` from the project directory and open the same address. Do not open `index.html` directly; the relationship data is loaded over HTTP.

## Explore

- Search by Terraform resource name and choose **Explore**.
- The map is a top-down dependency path: the root resource is at the top, then its dependant collections and resources appear below.
- Expand a dependant collection to reveal its resources. Selecting a dependant keeps the chosen chain visible and adds that resource's dependant collections underneath, so you can follow the path step by step. Click an expanded collection to collapse its branch, or use **Collapse all collections** to return to the root.
- Extending the path preserves the current zoom. Sibling collections and resources on the active level remain available but are visually minimized; category collections use squared cards while resources use softer rounded bubbles.
- The map fits the full dependency path while preserving the zoom controls and pan behavior.
- Drag bubbles to arrange them; use the controls or scroll to zoom, and drag the canvas to pan.
- Save a map from Mapping mode. Saved mappings retain the root-to-selected path, expanded branches, and bubble positions in this browser.
- In Saved mappings, select, rename, reorder, or delete saved maps. Recent resource history and saved maps are stored in browser local storage.

## Relationship data and regeneration

[`data/relationships.json`](./data/relationships.json) currently catalogs all **1,506 managed resource types** in HashiCorp AWS provider v6.0.0 and combines the initial curated examples with references observed in **31 public `terraform-aws-modules` repositories**. The generated data records pinned module commit/file links, provider schema classifications, occurrence counts, and confidence. For generated edges, confidence is High for explicit `depends_on` and `for_each` references or schema-backed references seen in at least four sampled modules; it is Medium for other schema-backed references and Low when the target field cannot be matched to the pinned schema. Confidence does not mean the peer resource is mandatory.

To regenerate with the pinned provider version and current default revisions of the same public modules (Terraform, Git, and Python 3 are required):

```sh
terraform -chdir=tools/provider-schema init -backend=false -input=false
terraform -chdir=tools/provider-schema providers schema -json > /tmp/terraform-aws-provider-schema.json
sh scripts/fetch_public_modules.sh .cache/aws-modules
python3 scripts/generate_relationships.py \
  --schema /tmp/terraform-aws-provider-schema.json \
  --modules .cache/aws-modules \
  --existing data/relationships.json \
  --output data/relationships.json
```

The generator pins the actual Git commit in every source URL and in dataset metadata so the resulting evidence is reproducible. It replaces its previously generated edges on each run while preserving the original curated examples. The module fetch script skips repositories already cloned at the destination; update them explicitly if newer revisions are desired.

The graph contains managed AWS resources only; data sources and variables are not nodes. An arrow follows the reference from the resource being referenced to the resource configuration containing it. Provider schemas establish whether an argument is required or optional, but do not by themselves prove that its value must come from another managed resource. `count` expressions are not included; `for_each` and explicit `depends_on` references are shown separately from provider arguments.

This is a best-effort estimate, not a complete or authoritative Terraform dependency graph. References are mined heuristically from a sample of public modules; references routed through module inputs/outputs, complex expressions, or unsupported HCL syntax can be missed, and a sampled pattern may not apply to every deployment. Terraform derives actual dependencies from each configuration's expressions. Review linked source before relying on a relationship.

## Deployment

The container serves static files and can be run locally or deployed to a container platform. This prototype does not include authentication, a shared database, server-side persistence, or production deployment configuration.
