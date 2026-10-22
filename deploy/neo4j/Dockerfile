# Neo4j for Liara. On first start (empty /data disk) it bulk-imports the Torob CSVs
# from seed/import.tar.gz and then creates the constraints and indexes from schema.cypher.
ARG NEO4J_IMAGE=neo4j:5.26-community
FROM ${NEO4J_IMAGE}
ENV NEO4J_server_memory_heap_initial__size=768m \
    NEO4J_server_memory_heap_max__size=768m \
    NEO4J_server_memory_pagecache_size=512m \
    NEO4J_PLUGINS='[]'
COPY seed/import.tar.gz /tmp/import.tar.gz
RUN mkdir -p /seed/import && tar -xzf /tmp/import.tar.gz -C /seed/import && rm /tmp/import.tar.gz \
 && chown -R neo4j:neo4j /seed
COPY schema.cypher /seed/schema.cypher
COPY seed-entrypoint.sh /seed-entrypoint.sh
RUN chmod +x /seed-entrypoint.sh
EXPOSE 7474 7687
ENTRYPOINT ["tini", "-g", "--", "/seed-entrypoint.sh"]
CMD ["neo4j"]
