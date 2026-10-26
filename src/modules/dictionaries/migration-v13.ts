/** Frozen v13 SQL: deliberately independent of the runtime ensure service. */
export const dictionaryMigrationV13Sql = `
-- A pre-existing active name wins over an automatically translated TYPE label.
UPDATE dictionary_items AS d SET archived=1
WHERE d.kind='TYPE' AND d.label=d.value AND d.archived=0
AND d.value IN ('MATH','CS','VOCABULARY','SENTENCE')
AND EXISTS(SELECT 1 FROM dictionary_items other
  WHERE other.owner=d.owner AND other.kind=d.kind AND other.value<>d.value AND other.archived=0
  AND other.normalized_name=CASE d.value WHEN 'MATH' THEN '数学错题' WHEN 'CS' THEN '408 专业课' WHEN 'VOCABULARY' THEN '英语生词' WHEN 'SENTENCE' THEN '英语长难句' END);
UPDATE dictionary_items SET
  label=CASE value WHEN 'MATH' THEN '数学错题' WHEN 'CS' THEN '408 专业课' WHEN 'VOCABULARY' THEN '英语生词' WHEN 'SENTENCE' THEN '英语长难句' END,
  normalized_name=CASE value WHEN 'MATH' THEN '数学错题' WHEN 'CS' THEN '408 专业课' WHEN 'VOCABULARY' THEN '英语生词' WHEN 'SENTENCE' THEN '英语长难句' END,
  version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE kind='TYPE' AND label=value AND value IN ('MATH','CS','VOCABULARY','SENTENCE');
WITH
entry_sources(owner,payload,active) AS (
  SELECT owner,payload,deleted_at IS NULL FROM entries
  UNION ALL SELECT owner,snapshot,0 FROM revisions
  UNION ALL SELECT m.owner,json_extract(r.value,'$.payload'),0
    FROM knowledge_merges m,json_each(m.payload,'$.before.records') r
  UNION ALL SELECT m.owner,json_extract(r.value,'$.payload'),0
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
missing AS (
  SELECT r.owner,r.kind,r.value,max(r.active) active,
    CASE WHEN r.kind='TYPE' THEN CASE r.value WHEN 'MATH' THEN '数学错题' WHEN 'CS' THEN '408 专业课' WHEN 'VOCABULARY' THEN '英语生词' WHEN 'SENTENCE' THEN '英语长难句' ELSE r.value END ELSE r.value END label
  FROM refs r WHERE NOT EXISTS(
    SELECT 1 FROM dictionary_items d WHERE d.owner=r.owner AND d.kind=r.kind AND d.value=r.value
  ) GROUP BY r.owner,r.kind,r.value
),
normalized AS (
  SELECT *,dictionary_normalize(label) normalized_name FROM missing
),
existing_order AS MATERIALIZED (
  SELECT owner,kind,max(sort_order) last_order FROM dictionary_items GROUP BY owner,kind
),
ranked AS (
  SELECT *,row_number() OVER(PARTITION BY owner,kind,normalized_name ORDER BY active DESC,value COLLATE BINARY) name_rank,
    row_number() OVER(PARTITION BY owner,kind ORDER BY value COLLATE BINARY) position
  FROM normalized
)
INSERT OR IGNORE INTO dictionary_items(owner,kind,value,label,normalized_name,template,sort_order,archived,version,created_at,updated_at)
SELECT r.owner,r.kind,r.value,r.label,r.normalized_name,
  CASE WHEN r.kind='TYPE' AND r.value IN ('MATH','CS','VOCABULARY','SENTENCE') THEN r.value ELSE 'GENERIC' END,
  coalesce(existing_order.last_order,-1)+r.position,
  CASE WHEN r.active=1 AND r.name_rank=1 AND NOT EXISTS(
    SELECT 1 FROM dictionary_items d WHERE d.owner=r.owner AND d.kind=r.kind AND d.archived=0 AND d.normalized_name=r.normalized_name
  ) THEN 0 ELSE 1 END,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ranked r LEFT JOIN existing_order ON existing_order.owner=r.owner AND existing_order.kind=r.kind;
`;
