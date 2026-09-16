FROM postgres:17-alpine

COPY docker/postgres/00-local-roles.sql /docker-entrypoint-initdb.d/00-local-roles.sql
COPY supabase/migrations/ /docker-entrypoint-initdb.d/
