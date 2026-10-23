export type AiAuditRecord = {
  id: string;
  action: string;
  model: string;
  host: string;
  created_at: string;
  duration: number;
  status: string;
  tokens: number | null;
  feedback: string;
  result: Record<string, unknown> | null;
  cost?: {
    amount: number;
    inputTokens: number;
    outputTokens: number;
    price: {
      currency: string;
      source: string;
      updated: string;
      input: number;
      output: number;
    };
  } | null;
};
