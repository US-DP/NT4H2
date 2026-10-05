import sys,os,json,glob
sys.stdout.reconfigure(encoding="utf-8")
print("== assets ==")
for f in glob.glob("docs/**/*",recursive=True):
    if os.path.isfile(f) and not f.endswith(".md"): print(f)
for f in glob.glob("**/*.png",recursive=True):
    if "node_modules" not in f: print("PNG:",f)
print("== root package.json scripts ==")
print(json.dumps(json.load(open("package.json")).get("scripts",{}),indent=0))
print("== docker-compose ==")
for f in glob.glob("*compose*")+glob.glob("Dockerfile*"): print(f)
print("== README actual (completo) ==")
print(open("README.md",encoding="utf-8").read())
