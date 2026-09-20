#!/usr/bin/env python3
"""Fails when `forge coverage --report summary` output (on stdin) is under the gate.

Usage: forge coverage --report summary --no-match-coverage "(test|script|lib)" | python3 script/check-coverage.py 90 55
"""
import re
import sys

min_lines, min_branches = float(sys.argv[1]), float(sys.argv[2])
total = next((line for line in sys.stdin if line.startswith("| Total")), None)
if total is None:
    sys.exit("no Total row in the coverage summary")

# Total row: | Total | lines | statements | branches | funcs |
cells = [cell.strip() for cell in total.strip().strip("|").split("|")]
lines, branches = (float(re.match(r"([\d.]+)%", cells[i]).group(1)) for i in (1, 3))
print(f"lines {lines}% (min {min_lines}%), branches {branches}% (min {min_branches}%)")
if lines < min_lines or branches < min_branches:
    sys.exit("coverage is below the gate")
