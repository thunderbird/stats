import datetime
import json
import sys
import tools

if not (len(sys.argv) == 3):
    print("First argument is filename and second argument is a key to remove from the JSON.")
    sys.exit()

filename = sys.argv[1]
key = sys.argv[2]

with open (filename, 'r') as file:
    cached = json.load(file)
    cached.pop(key, None)

with open(filename, 'w') as file:
    json.dump(cached, file)



