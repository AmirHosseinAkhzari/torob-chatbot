#!/bin/bash
# First start only: import the seed CSVs into an empty /data, then apply the schema once the server is up.
set -e
PENDING=/data/.torob-schema-pending
if [ ! -d /data/databases/neo4j ]; then
  echo ">> Importing seed graph"
  I=/seed/import
  /startup/docker-entrypoint.sh neo4j-admin database import full neo4j \
    --overwrite-destination=true --multiline-fields=true --array-delimiter='|' --skip-bad-relationships=false \
    --nodes=$I/shops.csv --nodes=$I/products.csv --nodes=$I/offers.csv --nodes=$I/categories.csv \
    --nodes=$I/brands.csv --nodes=$I/areas.csv --nodes=$I/payment_providers.csv \
    --relationships=$I/rel_shop_has_offer.csv --relationships=$I/rel_offer_for_product.csv \
    --relationships=$I/rel_product_in_category.csv --relationships=$I/rel_product_made_by.csv \
    --relationships=$I/rel_shop_sells_category.csv --relationships=$I/rel_shop_located_in.csv \
    --relationships=$I/rel_shop_accepts_payment.csv
  touch "$PENDING"
fi
if [ -f "$PENDING" ]; then
  (
    PASS="${NEO4J_AUTH#*/}"
    until cypher-shell -u neo4j -p "$PASS" "RETURN 1" >/dev/null 2>&1; do sleep 5; done
    echo ">> Creating constraints and indexes"
    cypher-shell -u neo4j -p "$PASS" -f /seed/schema.cypher \
      && cypher-shell -u neo4j -p "$PASS" "CALL db.awaitIndexes(1800)" \
      && rm -f "$PENDING" && echo ">> Schema ready"
  ) &
fi
exec /startup/docker-entrypoint.sh "$@"
