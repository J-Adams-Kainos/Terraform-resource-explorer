#!/usr/bin/env python3
"""Mine AWS resource references from provider schemas and public Terraform modules."""

import argparse
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

RESOURCE_BLOCK = re.compile(
    r'(?m)^[ \t]*resource[ \t]+"(aws_[a-zA-Z0-9_]+)"[ \t]+"[^"]+"[ \t]*\{'
)
LOCAL_BLOCK = re.compile(r"(?m)^[ \t]*locals[ \t]*\{")
REFERENCE = re.compile(r"(?<![\w.])(aws_[a-zA-Z0-9_]+)\.([A-Za-z0-9_-]+)")
LOCAL_REFERENCE = re.compile(r"\blocal\.([A-Za-z0-9_-]+)\b")
ATTRIBUTE_ASSIGNMENT = re.compile(r"(?m)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*=(?![=>])")
COMMENT_OR_STRING = re.compile(
    r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|#[^\n]*|//[^\n]*|/\*.*?\*/',
    re.DOTALL,
)
META_ARGUMENTS = {"count"}


def block_end(text, open_index):
    depth = 0
    quoted = False
    escaped = False
    line_comment = False
    block_comment = False
    heredoc_end = None
    i = open_index
    while i < len(text):
        if heredoc_end:
            line_end = text.find("\n", i)
            if line_end < 0:
                return len(text)
            if text[i:line_end].strip() == heredoc_end:
                heredoc_end = None
            i = line_end + 1
            continue
        char = text[i]
        next_char = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                i += 1
        elif quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "#" or (char == "/" and next_char == "/"):
            line_comment = True
            if char == "/":
                i += 1
        elif char == "/" and next_char == "*":
            block_comment = True
            i += 1
        elif char == "<" and text[i:i + 2] == "<<":
            match = re.match(r"<<-?[ \t]*([A-Za-z_][A-Za-z0-9_]*)", text[i:])
            if match:
                heredoc_end = match.group(1)
                newline = text.find("\n", i)
                if newline < 0:
                    return len(text)
                i = newline
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def clean_hcl(text):
    return COMMENT_OR_STRING.sub(lambda match: re.sub(r"[^\n]", " ", match.group()), text)


def iter_blocks(text, pattern):
    for match in pattern.finditer(text):
        opening = text.find("{", match.start(), match.end())
        end = block_end(text, opening)
        yield match, text[opening + 1:end - 1]


def local_values(body):
    clean_body = clean_hcl(body)
    values = {}
    current_name = None
    current_value = []
    nesting = {"{": 0, "[": 0, "(": 0}
    closing = {"}": "{", "]": "[", ")": "("}

    def finish_value():
        if current_name is not None:
            values[current_name] = "\n".join(current_value)

    for line in clean_body.splitlines():
        top_level = not any(nesting.values())
        assignment = re.match(r"^[ \t]*([A-Za-z_][A-Za-z0-9_-]*)[ \t]*=(.*)$", line) if top_level else None
        if assignment:
            finish_value()
            current_name = assignment.group(1)
            current_value = [assignment.group(2)]
        elif current_name is not None:
            current_value.append(line)
        for char in line:
            if char in nesting:
                nesting[char] += 1
            elif char in closing:
                opener = closing[char]
                nesting[opener] = max(0, nesting[opener] - 1)
    finish_value()
    return values


def resolved_references(body, locals_by_name):
    result = {(match.group(1), match.group(2)) for match in REFERENCE.finditer(body)}
    pending = [match.group(1) for match in LOCAL_REFERENCE.finditer(body)]
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        expression = locals_by_name.get(name)
        if expression is None:
            continue
        result.update((match.group(1), match.group(2)) for match in REFERENCE.finditer(expression))
        pending.extend(match.group(1) for match in LOCAL_REFERENCE.finditer(expression))
    return result


def field_at(body, position, resources, target_resource):
    assignments = list(ATTRIBUTE_ASSIGNMENT.finditer(body, 0, position))
    enclosing = []
    for assignment in assignments:
        depth = 0
        for char in body[assignment.end():position]:
            if char in "{[(":
                depth += 1
            elif char in "}])":
                depth = max(0, depth - 1)
        if depth:
            enclosing.append(assignment)
    candidates = enclosing or assignments[-1:]
    if any(assignment.group(1) == "for_each" for assignment in candidates):
        return "for_each"
    schema_assignments = [
        assignment for assignment in candidates
        if schema_argument(resources, target_resource, assignment.group(1))
    ]
    if schema_assignments:
        return schema_assignments[-1].group(1)
    if enclosing:
        return enclosing[-1].group(1)
    return assignments[-1].group(1) if assignments else None


def module_sources(module_root, revisions):
    for module_dir in sorted(path for path in module_root.iterdir() if path.is_dir()):
        repo_name = f"terraform-aws-{module_dir.name}"
        commit = revisions[module_dir.name]
        base_url = f"https://github.com/terraform-aws-modules/{repo_name}/blob/{commit}"
        for path in module_dir.rglob("*.tf"):
            if any(part in {".git", ".terraform"} for part in path.parts):
                continue
            yield module_dir.name, base_url, path, path.read_text(errors="replace")


def relation_name(resource_id):
    parts = resource_id.removeprefix("aws_").split("_")
    known_services = {
        "acm": "ACM", "alb": "ALB", "api_gateway": "API Gateway", "apigateway": "API Gateway",
        "cloudfront": "CloudFront", "cloudwatch": "CloudWatch", "dynamodb": "DynamoDB",
        "ebs": "EBS", "ec2": "EC2", "ecr": "ECR", "ecs": "ECS", "efs": "EFS",
        "eks": "EKS", "elasticache": "ElastiCache", "elb": "ELB", "iam": "IAM",
        "kms": "KMS", "lambda": "Lambda", "nacl": "Network ACL", "nat": "NAT",
        "rds": "RDS", "s3": "S3", "sns": "SNS", "sqs": "SQS", "vpc": "VPC",
        "wafv2": "WAFv2",
    }
    service_key = "_".join(parts[:2]) if parts[:2] in (["api", "gateway"],) else parts[0]
    category = known_services.get(service_key, service_key.replace("-", " ").title())
    return " ".join(part.replace("-", " ").title() for part in parts), category


def provider_resource_index(schema):
    provider = schema["provider_schemas"]["registry.terraform.io/hashicorp/aws"]
    resources = provider.get("resource_schemas", {})
    return provider, resources


def resource_nodes(resources, existing_nodes):
    nodes = {node["id"]: node for node in existing_nodes}
    for resource_id in resources:
        if resource_id in nodes:
            continue
        name, category = relation_name(resource_id)
        nodes[resource_id] = {
            "id": resource_id,
            "name": name,
            "category": category,
            "kind": "Resource",
            "url": f"https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{resource_id.removeprefix('aws_')}",
            "description": f"AWS {name} resource managed by the HashiCorp AWS provider.",
        }
    return nodes


def schema_argument(resources, resource_id, field):
    block = resources.get(resource_id, {}).get("block", {})
    pending = [block]
    while pending:
        current = pending.pop()
        attribute = current.get("attributes", {}).get(field)
        if attribute:
            return attribute
        for nested in current.get("block_types", {}).values():
            if nested.get("type_name") == field:
                return nested
            child_block = nested.get("block")
            if child_block:
                pending.append(child_block)
    return None


def classify_argument(resources, target_resource, field):
    if field == "depends_on":
        return "Explicit dependency", "The target resource explicitly declares this dependency with Terraform's depends_on meta-argument."
    if field == "for_each":
        return "Instance expansion reference", "The target resource's instances are expanded from an expression containing this resource reference."
    attribute = schema_argument(resources, target_resource, field)
    if not isinstance(attribute, dict):
        return "Observed resource reference", "The referenced value occurs in a resource configuration; inspect the provider schema for this argument."
    if attribute.get("required"):
        return "Required argument reference", "The target resource requires this argument; the value may still come from a variable or data source."
    if attribute.get("optional"):
        return "Optional argument reference", "The target resource can accept this argument; it is not required in every configuration."
    return "Observed resource reference", "The argument is computed or nested in the provider schema; verify the exact provider documentation."


def discover_edges(resources, module_root, revisions):
    observations = defaultdict(lambda: {"modules": set(), "files": set(), "count": 0})
    for module, base_url, path, source in module_sources(module_root, revisions):
        text = clean_hcl(source)
        relative = path.relative_to(module_root / module).as_posix()
        source_url = f"{base_url}/{relative}"
        locals_by_name = {}
        for _, body in iter_blocks(source, LOCAL_BLOCK):
            locals_by_name.update(local_values(body))
        for block_match, body in iter_blocks(source, RESOURCE_BLOCK):
            target_resource = block_match.group(1)
            if target_resource not in resources:
                continue
            clean_body = clean_hcl(body)
            references_by_field = defaultdict(set)
            for ref in REFERENCE.finditer(clean_body):
                field = field_at(clean_body, ref.start(), resources, target_resource)
                if field and field not in META_ARGUMENTS:
                    references_by_field[field].add(ref.group(1))
            for local_ref in LOCAL_REFERENCE.finditer(clean_body):
                field = field_at(clean_body, local_ref.start(), resources, target_resource)
                if not field or field in META_ARGUMENTS:
                    continue
                expression = locals_by_name.get(local_ref.group(1), "")
                for source_resource, _ in resolved_references(expression, locals_by_name):
                    references_by_field[field].add(source_resource)

            for field, source_resources in references_by_field.items():
                for source_resource in source_resources:
                    if source_resource not in resources:
                        continue
                    key = (source_resource, target_resource, field)
                    observations[key]["modules"].add(module)
                    observations[key]["files"].add(source_url)
                    observations[key]["count"] += 1
    return observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, required=True, help="terraform providers schema -json output")
    parser.add_argument("--modules", type=Path, required=True, help="Directory of cloned public terraform-aws-modules repositories")
    parser.add_argument("--existing", type=Path, required=True, help="Existing curated relationship JSON")
    parser.add_argument("--output", type=Path, required=True, help="Output relationship JSON")
    args = parser.parse_args()

    schema_json = json.loads(args.schema.read_text())
    existing = json.loads(args.existing.read_text())
    provider, provider_resources = provider_resource_index(schema_json)
    revisions = {}
    for module_dir in sorted(path for path in args.modules.iterdir() if path.is_dir()):
        try:
            revisions[module_dir.name] = subprocess.check_output(
                ["git", "-C", str(module_dir), "rev-parse", "HEAD"], text=True
            ).strip()
        except subprocess.CalledProcessError as error:
            raise RuntimeError(f"Could not identify source revision for {module_dir}: {error}") from error
    observations = discover_edges(provider_resources, args.modules, revisions)
    nodes = resource_nodes(provider_resources, existing.get("resources", []))
    edges = {
        (edge["from"], edge["to"], edge.get("field", "")): edge
        for edge in existing.get("relationships", [])
        if not edge.get("generated")
    }

    for (source_resource, target_resource, field), observation in observations.items():
        key = (source_resource, target_resource, field)
        modules = sorted(observation["modules"])
        files = sorted(observation["files"])
        nature, note = classify_argument(provider_resources, target_resource, field)
        argument_schema = schema_argument(provider_resources, target_resource, field)
        existing_edge = edges.get(key)
        if existing_edge:
            existing_edge["moduleSources"] = files[:8]
            existing_edge["moduleOccurrences"] = observation["count"]
            existing_edge["moduleCount"] = len(modules)
            existing_edge["observedNature"] = nature
            existing_edge.pop("moduleSource", None)
            continue
        evidence = f"Observed in {len(modules)} public AWS module(s), {observation['count']} reference(s)"
        confidence = "High" if field in {"depends_on", "for_each"} or (argument_schema and len(modules) >= 4) else "Medium" if argument_schema else "Low"
        edges[key] = {
            "from": source_resource,
            "to": target_resource,
            "field": field,
            "nature": nature,
            "note": note,
            "source": f"https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{target_resource.removeprefix('aws_')}",
            "schemaSource": "https://developer.hashicorp.com/terraform/cli/commands/providers/schema",
            "evidence": evidence,
            "confidence": confidence,
            "moduleCount": len(modules),
            "moduleOccurrences": observation["count"],
            "moduleSources": files[:8],
            "generated": True,
        }

    metadata = dict(existing.get("metadata", {}))
    metadata.pop("publicModule", None)
    metadata.pop("moduleSourceCommit", None)
    metadata.update({
        "provider": "hashicorp/aws",
        "providerVersion": "6.0.0",
        "dataSourceAndVariableNodes": False,
        "relationshipGeneration": "Terraform provider schema plus resource-reference, for_each, and depends_on observations in checked-out public terraform-aws-modules repositories.",
        "moduleRepositoryCount": len([path for path in args.modules.iterdir() if path.is_dir()]),
        "moduleSourceRevisions": [
            {
                "repository": f"terraform-aws-modules/terraform-aws-{name}",
                "commit": commit,
                "url": f"https://github.com/terraform-aws-modules/terraform-aws-{name}/tree/{commit}",
            }
            for name, commit in sorted(revisions.items())
        ],
        "managedResourceSchemaCount": len(provider_resources),
        "moduleObservedRelationshipCount": len(observations),
        "scope": "AWS provider managed resource catalog with observed resource-to-resource references from a sample of public AWS Terraform modules. Data sources and variables are not graph nodes. This is not a universal or configuration-specific dependency graph.",
    })
    output = {
        "metadata": metadata,
        "resources": sorted(nodes.values(), key=lambda node: node["id"]),
        "relationships": sorted(edges.values(), key=lambda edge: (edge["from"], edge["to"], edge.get("field", ""))),
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Wrote {len(output['resources'])} managed resources and {len(output['relationships'])} relationships.")
    print(f"Found {len(observations)} resource/field observations in {metadata['moduleRepositoryCount']} public modules.")


if __name__ == "__main__":
    main()
