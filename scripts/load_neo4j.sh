#!/usr/bin/env bash
# Rebuild the Torob knowledge graph from scratch:
#   1. convert raw CSVs -> neo4j-admin import CSVs
#   2. bulk import into a fresh `neo4j` database (wipes the existing one)
#   3. start the server and create constraints / indexes
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

RAW_DIR="${1:-$TOROB_DATASET_DIR}"
COMPOSE="docker compose"

echo ">> Preparing import files from $RAW_DIR"
python3 -I scripts/prepare_import.py "$RAW_DIR" data/import

echo ">> Stopping Neo4j (if running)"
$COMPOSE stop neo4j >/dev/null 2>&1 || true

echo ">> Bulk importing"
$COMPOSE run --rm --no-deps neo4j neo4j-admin database import full neo4j \
  --overwrite-destination=true \
  --multiline-fields=true \
  --array-delimiter='|' \
  --skip-bad-relationships=false \
  --nodes=/import/shops.csv \
  --nodes=/import/products.csv \
  --nodes=/import/offers.csv \
  --nodes=/import/categories.csv \
  --nodes=/import/brands.csv \
  --nodes=/import/areas.csv \
  --nodes=/import/payment_providers.csv \
  --relationships=/import/rel_shop_has_offer.csv \
  --relationships=/import/rel_offer_for_product.csv \
  --relationships=/import/rel_product_in_category.csv \
  --relationships=/import/rel_product_made_by.csv \
  --relationships=/import/rel_shop_sells_category.csv \
  --relationships=/import/rel_shop_located_in.csv \
  --relationships=/import/rel_shop_accepts_payment.csv

echo ">> Starting Neo4j"
$COMPOSE up -d neo4j
until $COMPOSE exec -T neo4j cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1" >/dev/null 2>&1; do
  sleep 3
done

echo ">> Creating constraints and indexes"
$COMPOSE exec -T neo4j cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" < scripts/schema.cypher
$COMPOSE exec -T neo4j cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "CALL db.awaitIndexes(600)"

echo ">> Done. Browser: http://localhost:${NEO4J_HTTP_PORT}  Bolt: bolt://localhost:${NEO4J_BOLT_PORT}"
