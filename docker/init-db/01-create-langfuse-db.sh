#!/bin/bash
# Creates the 'langfuse' database on first PostgreSQL boot.
# Langfuse cannot share the main Tiburcio database (Prisma migration P3005 conflict).
# This script runs automatically via docker-entrypoint-initdb.d/.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE langfuse;
EOSQL
