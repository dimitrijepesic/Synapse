import sys
sys.path.insert(0, "/home/nenad/work/hackupc/hackupc/backend")

import json
from parser import parse_repo

result = parse_repo("test/katana-swift", repo_name="BendingSpoons/katana-swift")

with open("test/output.json", "w") as f:
    json.dump(result, f, indent=2)

print("Done! Check test/output.json")