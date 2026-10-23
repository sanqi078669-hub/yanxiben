import { handleRequest } from "../../../../modules/http/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export {
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as PATCH,
  handleRequest as DELETE,
};
