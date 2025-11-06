#!/usr/bin/env python3
import zipfile
import sys

if len(sys.argv) != 2:
    print("Usage: validate-zip.py <zipfile>")
    sys.exit(1)

try:
    with zipfile.ZipFile(sys.argv[1], 'r') as z:
        result = z.testzip()
        if result:
            print(f"Error in: {result}")
            sys.exit(1)
        print("OK")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
