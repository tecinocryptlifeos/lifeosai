import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NorthflankOriginOptionalTests(unittest.TestCase):
    def test_production_worker_does_not_define_northflank_origin(self):
        wrangler = (ROOT / "infrastructure/cloudflare/wrangler.toml.template").read_text(encoding="utf-8")
        self.assertNotRegex(wrangler, r"(?m)^NORTHFLANK_ORIGIN\s*=")

    def test_health_evaluator_is_edge_only_and_never_reads_northflank_origin(self):
        health = (ROOT / "services/edge-gateway/src/health.js").read_text(encoding="utf-8")
        self.assertNotIn("NORTHFLANK_ORIGIN", health)
        self.assertNotIn("fetch(", health)
        self.assertIn('preferred: "edge"', health)
        self.assertIn("return evaluateOrigins(env);", health)

    def test_documentation_declares_northflank_optional(self):
        runbook = (ROOT / "docs/deployment/DEPLOYMENT_RUNBOOK.md").read_text(encoding="utf-8")
        self.assertIn("NORTHFLANK_ORIGIN is optional", runbook)


if __name__ == "__main__":
    unittest.main()
