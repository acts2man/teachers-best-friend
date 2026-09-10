import { createServiceClient } from "@/lib/supabase/service";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type PipelineStage = {
  stage: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
};

const REASONING_EFFORTS: ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
];
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { loadedAt: number; stages: Map<string, PipelineStage> } | null =
  null;
let inflight: Promise<Map<string, PipelineStage>> | null = null;

async function load() {
  const { data, error } = await createServiceClient()
    .from("pipeline_config")
    .select("stage, model, reasoning_effort, max_output_tokens");
  if (error) throw error;
  const stages = new Map<string, PipelineStage>();
  for (const row of data ?? []) {
    const effort = String(row.reasoning_effort ?? "");
    const maxOutputTokens = Number(row.max_output_tokens);
    if (
      !row.stage ||
      !row.model ||
      !REASONING_EFFORTS.includes(effort as ReasoningEffort) ||
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens <= 0
    ) {
      // A malformed row is left out so the caller sees "not configured"
      // instead of sending a bad request to the model provider.
      console.error("pipeline_config row is invalid", row.stage ?? "?");
      continue;
    }
    stages.set(String(row.stage), {
      stage: String(row.stage),
      model: String(row.model),
      reasoningEffort: effort as ReasoningEffort,
      maxOutputTokens,
    });
  }
  return stages;
}

/**
 * Model routing for each pipeline stage, read from public.pipeline_config
 * with the service-role client and memoized for five minutes. A failed
 * load is not cached, so the next call retries.
 */
export async function pipelineConfig(): Promise<Map<string, PipelineStage>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.stages;
  if (!inflight) {
    inflight = load()
      .then((stages) => {
        cache = { loadedAt: Date.now(), stages };
        return stages;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The routing row for one stage, or null when the stage is not configured. */
export async function pipelineStage(stage: string) {
  return (await pipelineConfig()).get(stage) ?? null;
}
