import tempfile
import unittest
from pathlib import Path

from scripts.generate_relationships import classify_argument, discover_edges


class DiscoverEdgesTests(unittest.TestCase):
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
