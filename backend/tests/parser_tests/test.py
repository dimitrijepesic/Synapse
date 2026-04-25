import sys
sys.path.insert(0, "/home/nenad/work/hackupc/hackupc/backend")

import json
from parser import parse_repo

result = parse_repo("hackupc", repo_name="HACKUPC")

with open("output.json", "w") as f:
    json.dump(result, f, indent=2)

print("Done! Check test/output.json")




# test.py
# import sys
# sys.path.insert(0, "/home/nenad/work/hackupc/hackupc/backend")

# import json
# from parser import parse_repo

# test_folders = ["test1", "test2", "test3"]

# for folder in test_folders:
#     print(f"Parsing {folder}...")
#     result = parse_repo(folder, repo_name=folder)
    
#     output_file = f"{folder}_output.json"
#     with open(output_file, "w") as f:
#         json.dump(result, f, indent=2)
    
#     print(f"Done! Check {output_file}")