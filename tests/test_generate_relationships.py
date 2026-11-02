import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.generate_relationships import (
    classify_argument,
    configurable_fields,
    discover_edges,
    resource_nodes,
)

ROOT = Path(__file__).resolve().parents[1]


class DiscoverEdgesTests(unittest.TestCase):
    def test_resource_nodes_include_provider_required_fields(self):
        resources = {
            "aws_subnet": {
                "block": {
                    "attributes": {
                        "vpc_id": {"required": True},
                        "cidr_block": {"required": True},
                        "tags": {"optional": True, "type": ["map", "string"]},
                        "arn": {"computed": True, "type": "string"},
                    },
                    "block_types": {
                        "timeouts": {
                            "nesting_mode": "single",
                            "block": {
                                "attributes": {
                                    "create": {"optional": True, "type": "string"},
                                    "id": {"computed": True, "type": "string"},
                                }
                            },
                        }
                    },
                }
            }
        }
        existing = [{"id": "aws_subnet", "name": "Subnet"}]

        nodes = resource_nodes(resources, existing)

        self.assertEqual(nodes["aws_subnet"]["requiredFields"], ["cidr_block", "vpc_id"])

    def test_extracts_only_configurable_schema_fields(self):
        fields = configurable_fields({
            "attributes": {
                "computed_value": {"computed": True},
                "required_value": {"required": True, "type": "string"},
                "optional_value": {"optional": True, "computed": True, "type": "bool"},
            },
            "block_types": {
                "timeouts": {
                    "nesting_mode": "single",
                    "block": {
                        "attributes": {
                            "create": {"optional": True, "type": "string"},
                            "id": {"computed": True, "type": "string"},
                        }
                    },
                }
            },
        })

        self.assertEqual(
            fields,
            [
                {"name": "optional_value", "required": False},
                {"name": "required_value", "required": True},
                {"name": "timeouts", "required": False, "nestingMode": "single", "block": True, "fields": [
                    {"name": "create", "required": False}
                ]},
            ],
        )

    def test_generator_writes_configurable_fields_to_a_sidecar(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            modules = temporary / "modules"
            modules.mkdir()
            schema_path = temporary / "schema.json"
            existing_path = temporary / "existing.json"
            output_path = temporary / "relationships.json"
            configuration_path = temporary / "configuration-fields.json"
            schema_path.write_text(json.dumps({
                "provider_schemas": {
                    "registry.terraform.io/hashicorp/aws": {
                        "resource_schemas": {
                            "aws_subnet": {
                                "block": {
                                    "attributes": {
                                        "vpc_id": {"required": True, "type": "string"},
                                        "arn": {"computed": True, "type": "string"},
                                    }
                                }
                            }
                        }
                    }
                }
            }))
            existing_path.write_text(json.dumps({
                "metadata": {},
                "resources": [{"id": "aws_subnet", "name": "Subnet"}],
                "relationships": [],
            }))

            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "generate_relationships.py"),
                    "--schema", str(schema_path),
                    "--modules", str(modules),
                    "--existing", str(existing_path),
                    "--output", str(output_path),
                    "--configuration-output", str(configuration_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            output = json.loads(output_path.read_text())
            configuration = json.loads(configuration_path.read_text())

        self.assertEqual(configuration["aws_subnet"], [
            {"name": "vpc_id", "required": True},
        ])
        self.assertEqual(output["resources"][0]["requiredFields"], ["vpc_id"])
        self.assertNotIn("configFields", output["resources"][0])

    def test_labels_explicit_and_instance_expansion_dependencies(self):
        self.assertEqual(
            classify_argument({}, "aws_instance", "depends_on")[0],
            "Explicit dependency",
        )
        self.assertEqual(
            classify_argument({}, "aws_instance", "for_each")[0],
            "Instance expansion reference",
        )

    def test_tracks_local_references_by_target_argument_and_skips_meta_arguments(self):
        source = """
locals {
  security_group_ids = [aws_security_group.rules.id]
}

resource "aws_instance" "example" {
  count = length(aws_subnet.private) > 0 ? 1 : 0
  for_each = var.network_mode == "awsvpc" ? { service = local.security_group_ids } : {}
  vpc_security_group_ids = local.security_group_ids
}
"""
        resources = {
            "aws_instance": {},
            "aws_security_group": {},
            "aws_subnet": {},
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            module_root = Path(temporary_directory)
            module_directory = module_root / "fixture"
            module_directory.mkdir()
            (module_directory / "main.tf").write_text(source)

            observations = discover_edges(resources, module_root, {"fixture": "abc123"})

        self.assertEqual(
            set(observations),
            {
                ("aws_security_group", "aws_instance", "for_each"),
                ("aws_security_group", "aws_instance", "vpc_security_group_ids"),
            },
        )
        observation = observations[("aws_security_group", "aws_instance", "vpc_security_group_ids")]
        self.assertEqual(observation["count"], 1)
        self.assertEqual(observation["modules"], {"fixture"})

    def test_prefers_provider_argument_over_nested_policy_document_keys(self):
        source = """
resource "aws_s3_bucket_policy" "example" {
  policy = jsonencode({
    Statement = {
      Resource = aws_s3_bucket.example.arn
    }
  })
}
"""
        resources = {
            "aws_s3_bucket_policy": {
                "block": {"attributes": {"policy": {"optional": True}}}
            },
            "aws_s3_bucket": {},
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            module_root = Path(temporary_directory)
            module_directory = module_root / "fixture"
            module_directory.mkdir()
            (module_directory / "main.tf").write_text(source)

            observations = discover_edges(resources, module_root, {"fixture": "abc123"})

        self.assertIn(("aws_s3_bucket", "aws_s3_bucket_policy", "policy"), observations)


if __name__ == "__main__":
    unittest.main()
