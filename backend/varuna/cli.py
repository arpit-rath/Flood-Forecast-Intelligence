"""Run the complete fixture slice without cloud access."""

from __future__ import annotations

import argparse
import json

from .service import VarunaService


def main() -> None:
    parser = argparse.ArgumentParser(description="Varuna local fixture runner")
    parser.add_argument("command", choices=("demo",))
    parser.add_argument("--json", action="store_true", help="Print the full deterministic result")
    args = parser.parse_args()
    result = VarunaService().run_fixture()
    if args.json:
        print(json.dumps(result, sort_keys=True, indent=2))
        return
    snapshot, routes, interventions = result["snapshot"], result["routes"], result["interventions"]
    counts = {name: sum(item["class"] == name for item in snapshot["segments"]) for name in ("Low", "Watch", "High", "Unknown")}
    print(f"Mode: {snapshot['mode']} | synthetic fixture | segments: {len(snapshot['segments'])}")
    print(f"Risk: {counts}")
    print(f"Routes: fastest {routes['fastestRouteId']}, recommended {routes['recommendedRouteId']}")
    for item in interventions["results"]:
        print(f"Intervention #{item['rank']}: {item['drainId']} | exposure reduction {item['routeExposureReduction']:.6f} | High to lower: {item['segmentsMovedOutOfHigh']}")


if __name__ == "__main__":
    main()
