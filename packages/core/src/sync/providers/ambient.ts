import { z } from "zod";

import type { ExistingModel, SyncedModel, SyncProvider } from "../index.js";
import {
  buildOpenRouterModel,
  OpenRouterModel,
  resolveCanonicalBaseModel,
} from "./openrouter.js";

const API_ENDPOINT = "https://api.ambient.xyz/v1/models";

const AmbientModel = z.object({
  id: z.string(),
  name: z.string(),
  created: z.number(),
  hugging_face_id: z.string().nullable().optional(),
  context_length: z.number(),
  max_output_length: z.number().nullable().optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    internal_reasoning: z.string().optional(),
    input_cache_read: z.string().optional(),
    input_cache_write: z.string().optional(),
  }),
  supported_features: z.array(z.string()).optional(),
  supported_sampling_parameters: z.array(z.string()).optional(),
  openrouter: z.object({ slug: z.string() }).partial().nullable().optional(),
}).passthrough();

const AmbientResponse = z.object({
  data: z.array(AmbientModel),
}).passthrough();

type AmbientModel = z.infer<typeof AmbientModel>;

export const ambient = {
  id: "ambient",
  name: "Ambient",
  modelsDir: "providers/ambient/models",
  async fetchModels() {
    const headers = process.env.AMBIENT_API_KEY
      ? { Authorization: `Bearer ${process.env.AMBIENT_API_KEY}` }
      : undefined;
    const response = await fetch(API_ENDPOINT, { headers });
    if (!response.ok) {
      throw new Error(`Ambient request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  },
  parseModels(raw) {
    return AmbientResponse.parse(raw).data;
  },
  translateModel(model, context) {
    return {
      id: model.id,
      model: buildAmbientModel(model, context.existing(model.id)),
    };
  },
} satisfies SyncProvider<AmbientModel>;

export function buildAmbientModel(
  model: AmbientModel,
  existing: ExistingModel | undefined,
): SyncedModel {
  const synced = {
    ...buildOpenRouterModel(
      normalizeModel(model),
      existing,
      existing?.base_model ?? resolveAmbientBaseModel(model),
    ),
    reasoning_options: existing?.reasoning_options,
  };
  if ("base_model" in synced) return synced;
  return {
    ...synced,
    name: existing?.name ?? synced.name,
    release_date: existing?.release_date ?? synced.release_date,
    last_updated: existing?.last_updated ?? synced.last_updated,
  };
}

// Ambient reports the upstream OpenRouter slug (e.g. "z-ai/glm-5.1") for each
// served model, which is the canonical key models.dev already indexes by. Use
// it to inherit upstream metadata via base_model instead of a hand-kept map.
function resolveAmbientBaseModel(model: AmbientModel) {
  const slug = model.openrouter?.slug;
  return slug !== undefined ? resolveCanonicalBaseModel(slug) : undefined;
}

// Adapt Ambient's OpenAI-compatible /v1/models payload into the OpenRouter
// shape so the shared builder handles pricing, modalities, capabilities, and
// base_model factoring uniformly.
function normalizeModel(model: AmbientModel) {
  return OpenRouterModel.parse({
    id: model.openrouter?.slug ?? model.id,
    name: model.name,
    created: model.created,
    hugging_face_id: model.hugging_face_id ?? null,
    knowledge_cutoff: null,
    context_length: model.context_length,
    architecture: {
      input_modalities: model.input_modalities ?? ["text"],
      output_modalities: model.output_modalities ?? ["text"],
    },
    pricing: model.pricing,
    top_provider: {
      context_length: model.context_length,
      max_completion_tokens: model.max_output_length ?? null,
    },
    supported_parameters: [
      ...model.supported_sampling_parameters ?? [],
      ...model.supported_features ?? [],
    ],
  });
}
