/** Immutable schema steps. Add new migrations; do not edit applied steps. */
export const coreSchema = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS entries_owner ON entries(owner,deleted_at,updated_at);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),entry_id TEXT NOT NULL REFERENCES entries(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,parent_id TEXT REFERENCES knowledge(id),name TEXT NOT NULL,description TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),from_id TEXT NOT NULL REFERENCES entries(id),to_id TEXT NOT NULL REFERENCES entries(id),type TEXT NOT NULL,CHECK(from_id<>to_id),UNIQUE(from_id,to_id,type));
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),entry_id TEXT UNIQUE NOT NULL REFERENCES entries(id),stage TEXT NOT NULL,stage_index INTEGER NOT NULL,success_streak INTEGER NOT NULL,due_on TEXT NOT NULL,version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS reviews_due ON reviews(owner,stage,due_on);
CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),review_id TEXT NOT NULL REFERENCES reviews(id),mode TEXT NOT NULL,rating TEXT NOT NULL,local_date TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_schedule_per_day ON logs(review_id,local_date) WHERE mode='SCHEDULED';
CREATE INDEX IF NOT EXISTS logs_review_recent ON logs(review_id,created_at DESC);
CREATE INDEX IF NOT EXISTS logs_owner_date ON logs(owner,local_date);
CREATE TABLE IF NOT EXISTS idempotency(owner TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,scope,key));
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
`;
export const extensionSchema = `
CREATE TABLE IF NOT EXISTS knowledge_aliases(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),node_id TEXT NOT NULL REFERENCES knowledge(id),name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_merges(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_audit_extras(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,model TEXT NOT NULL,host TEXT NOT NULL,created_at TEXT NOT NULL,duration INTEGER NOT NULL,status TEXT NOT NULL,tokens INTEGER,result TEXT,feedback TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS batch_edits(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_prices(owner TEXT NOT NULL,model TEXT NOT NULL,host TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,model,host));
CREATE TABLE IF NOT EXISTS restore_workspaces(id TEXT PRIMARY KEY,owner TEXT NOT NULL,folder TEXT NOT NULL,counts TEXT NOT NULL,created TEXT NOT NULL,url TEXT,pid INTEGER);
CREATE TABLE IF NOT EXISTS backup_status(owner TEXT PRIMARY KEY,created TEXT NOT NULL);
`;
