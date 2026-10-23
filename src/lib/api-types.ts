import type { Entry } from "./model";
export type EntryList = {
  items: EntryListItem[];
  total: number;
  page: number;
  limit: number;
};
export type EntryListItem = Pick<
  Entry,
  | "id"
  | "owner"
  | "type"
  | "title"
  | "subject"
  | "status"
  | "body"
  | "source"
  | "version"
  | "created_at"
  | "updated_at"
  | "deleted_at"
> & { lemma: string | null; partOfSpeech: string | null };
export type KnowledgeNode = {
  id: string;
  owner: string;
  subject: string;
  parent_id: string | null;
  name: string;
  description: string;
  archived: number;
};
