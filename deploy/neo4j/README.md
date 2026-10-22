# Neo4j on Liara

Liara app `torob-neo4j` (Docker platform, port 7474, disk `data` at `/data`, team تیم ۲). Liara limits a deploy
upload to 128 MB, so the image ships the import CSVs (gzip, ~81 MB) instead of a database dump.

`seed/` is git-ignored, and deploys skip git-ignored files, so deploy from a copy of this folder outside the repo:

```bash
D=$(mktemp -d)
cp deploy/neo4j/{Dockerfile,seed-entrypoint.sh,liara.json} scripts/schema.cypher "$D/"
mkdir "$D/seed" && tar -czf "$D/seed/import.tar.gz" -C data/import .   # data/import comes from scripts/load_neo4j.sh
liara deploy --path "$D"
```

On first start with an empty `/data` disk the entrypoint runs `neo4j-admin database import full`, starts Neo4j
and applies `schema.cypher` (indexes take a few minutes). Later starts reuse the data on the disk. To re-import,
empty the disk first.
