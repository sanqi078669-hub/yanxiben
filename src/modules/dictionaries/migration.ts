/** Frozen v12 backfill. Merge records contain JSON-encoded entry payloads. */
export const dictionaryMigrationSql = `
CREATE TABLE dictionary_items(
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('TYPE','SUBJECT','ERROR')),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'GENERIC' CHECK(template IN ('GENERIC','MATH','CS','VOCABULARY','SENTENCE')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner,kind,value)
);
CREATE UNIQUE INDEX dictionary_active_name ON dictionary_items(owner,kind,normalized_name) WHERE archived=0;
CREATE INDEX dictionary_list ON dictionary_items(owner,kind,archived,sort_order);
WITH
entry_sources(owner,payload,active) AS (
  SELECT owner,payload,deleted_at IS NULL FROM entries
  UNION ALL SELECT owner,snapshot,0 FROM revisions
  UNION ALL
  SELECT m.owner,json_extract(r.value,'$.payload'),0
  FROM knowledge_merges m,json_each(m.payload,'$.before.records') r
  UNION ALL
  SELECT m.owner,json_extract(r.value,'$.payload'),0
  FROM knowledge_merges m,json_each(m.payload,'$.after.records') r
),
knowledge_sources(owner,node) AS (
  SELECT owner,json_extract(payload,'$.before.source') FROM knowledge_merges
  UNION ALL SELECT owner,json_extract(payload,'$.before.target') FROM knowledge_merges
  UNION ALL SELECT m.owner,n.value FROM knowledge_merges m,json_each(m.payload,'$.before.children') n
  UNION ALL SELECT m.owner,n.value FROM knowledge_merges m,json_each(m.payload,'$.after.nodes') n
),
refs(owner,kind,value,active) AS (
  SELECT owner,'TYPE',json_extract(payload,'$.type'),active FROM entry_sources WHERE json_type(payload,'$.type')='text'
  UNION ALL SELECT owner,'SUBJECT',json_extract(payload,'$.subject'),active FROM entry_sources WHERE json_type(payload,'$.subject')='text'
  UNION ALL SELECT e.owner,'ERROR',j.value,e.active FROM entry_sources e,json_each(e.payload,'$.errors') j WHERE j.type='text'
  UNION ALL SELECT owner,'SUBJECT',subject,archived=0 FROM knowledge
  UNION ALL SELECT owner,'SUBJECT',json_extract(node,'$.subject'),0 FROM knowledge_sources WHERE json_type(node,'$.subject')='text'
  UNION ALL SELECT l.owner,'ERROR',j.value,0 FROM logs l,json_each(l.payload,'$.errorCauses') j WHERE j.type='text'
  UNION ALL SELECT l.owner,'ERROR',j.value,0 FROM logs l,json_each(l.payload,'$.errorSnapshot') j WHERE j.type='text'
),
distinct_values AS (
  SELECT owner,kind,value,max(active) active,dictionary_normalize(value) normalized_name
  FROM refs GROUP BY owner,kind,value
),
ranked AS (
  SELECT *,row_number() OVER(PARTITION BY owner,kind,normalized_name ORDER BY active DESC,value COLLATE BINARY) name_rank,
  row_number() OVER(PARTITION BY owner,kind ORDER BY
    CASE kind
      WHEN 'TYPE' THEN CASE value WHEN 'MATH' THEN 0 WHEN 'CS' THEN 1 WHEN 'VOCABULARY' THEN 2 WHEN 'SENTENCE' THEN 3 ELSE 100 END
      WHEN 'SUBJECT' THEN CASE value WHEN '高等数学' THEN 0 WHEN '数据结构' THEN 1 WHEN '计算机组成原理' THEN 2 WHEN '操作系统' THEN 3 WHEN '计算机网络' THEN 4 WHEN '英语' THEN 5 ELSE 100 END
      ELSE CASE value WHEN '概念' THEN 0 WHEN '条件' THEN 1 WHEN '方法' THEN 2 WHEN '计算' THEN 3 WHEN '审题' THEN 4 WHEN '表达' THEN 5 ELSE 100 END
    END,value COLLATE BINARY)-1 position
  FROM distinct_values
)
INSERT INTO dictionary_items(owner,kind,value,label,normalized_name,template,sort_order,archived,version,created_at,updated_at)
SELECT owner,kind,value,value,normalized_name,
  CASE WHEN kind='TYPE' AND value IN ('MATH','CS','VOCABULARY','SENTENCE') THEN value ELSE 'GENERIC' END,
  position,CASE WHEN active=1 AND name_rank=1 THEN 0 ELSE 1 END,1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ranked;
`;
