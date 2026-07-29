import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { enrichmentWaterfall } from "@/lib/inngest/functions/enrichmentWaterfall";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [enrichmentWaterfall],
});
