import type { Entry } from "./model";
export type EntryList = {
  items: Entry[];
  total: number;
  page: number;
  limit: number;
};
export type KnowledgeNode = {
  id: string;
  owner: string;
  subject: string;
  parent_id: string | null;
  name: string;
  description: string;
  archived: number;
};
