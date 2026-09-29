// Indexes the PL/SQL analysis gateway relies on. Every statement is
// idempotent (IF NOT EXISTS), so this file is safe to run after each load,
// restore, or deploy. The gateway looks objects and edge endpoints up by
// qualifiedName; without this index each hop scans every DatabaseObject.
CREATE INDEX plsql_database_object_qualified_name IF NOT EXISTS
FOR (n:DatabaseObject) ON (n.qualifiedName);
