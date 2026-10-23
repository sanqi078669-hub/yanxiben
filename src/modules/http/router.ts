import type { ApiHandler } from "./context";
import { accountHandler } from "./handlers/account";
import { aiHandler } from "./handlers/ai";
import { attachmentsHandler } from "./handlers/attachments";
import { dataHandler } from "./handlers/data";
import { entriesHandler } from "./handlers/entries";
import { knowledgeHandler } from "./handlers/knowledge";
import { reviewsHandler } from "./handlers/reviews";
export const resourceHandlers: Readonly<Record<string, ApiHandler>> = {
  auth: accountHandler,
  settings: accountHandler,
  ai: aiHandler,
  attachments: attachmentsHandler,
  data: dataHandler,
  exports: dataHandler,
  entries: entriesHandler,
  dashboard: entriesHandler,
  "knowledge-tools": knowledgeHandler,
  "knowledge-nodes": knowledgeHandler,
  reviews: reviewsHandler,
  "review-items": reviewsHandler,
};
