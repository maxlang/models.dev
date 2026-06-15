import { expect, test } from "bun:test";
import path from "node:path";

import {
  AmbientResponse,
  ambient,
  buildAmbientModel,
  resolveAmbientBaseModel,
  type AmbientModel,
} from "../src/sync/providers/ambient.js";

const catalogModel: AmbientModel = {
  id: "zai-org/GLM-5.1-FP8",
  name: "GLM 5.1",
  created: 1_775_520_000,
  context_length: 202_752,
  max_output_length: 131_072,
  input_modalities: ["text"],
  output_modalities: ["text"],
  pricing: {
    prompt: "0.0000014",
    completion: "0.0000044",
    input_cache_read: "0",
    input_cache_write: "0",
  },
  supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"],
  supported_sampling_parameters: ["temperature", "top_p"],
  hugging_face_id: "zai-org/GLM-5.1-FP8",
  openrouter: { slug: "z-ai/glm-5.1" },
};

test("Ambient resolves the OpenRouter slug to canonical metadata", () => {
  expect(resolveAmbientBaseModel(catalogModel)).toBe("zhipuai/glm-5.1");
  expect(resolveAmbientBaseModel({ ...catalogModel, openrouter: { slug: "moonshotai/kimi-k2.6" } }))
    .toBe("moonshotai/kimi-k2.6");
  // No upstream slug -> nothing to resolve.
  expect(resolveAmbientBaseModel({ ...catalogModel, openrouter: undefined })).toBeUndefined();
  // Slug present but no canonical metadata in /models -> falls back to a full model.
  expect(resolveAmbientBaseModel({ ...catalogModel, openrouter: { slug: "openai/gpt-oss-120b" } }))
    .toBeUndefined();
});

test("Ambient maps per-token pricing to per-million and inherits the canonical name", () => {
  const synced = buildAmbientModel(catalogModel, undefined);

  expect(synced).toMatchObject({
    base_model: "zhipuai/glm-5.1",
    cost: { input: 1.4, output: 4.4, cache_read: 0, cache_write: 0 },
    limit: { context: 202_752 },
  });
  // Ambient's served name "GLM 5.1" diverges from canonical "GLM-5.1" and is
  // intentionally NOT emitted as an override on base_model overlays (an
  // undefined name is dropped by the sync pipeline's stripUndefined).
  expect(synced.name).toBeUndefined();
});

test("Ambient preserves curated reasoning_options and interleaved metadata", () => {
  const synced = buildAmbientModel(catalogModel, {
    base_model: "zhipuai/glm-5.1",
    reasoning_options: [],
    interleaved: { field: "reasoning_content" },
  });

  expect(synced).toMatchObject({
    base_model: "zhipuai/glm-5.1",
    reasoning_options: [],
    interleaved: { field: "reasoning_content" },
  });
});

test("Ambient emits a full model when no canonical metadata exists", () => {
  const synced = buildAmbientModel({
    ...catalogModel,
    id: "openai/gpt-oss-120b",
    name: "gpt-oss-120b",
    openrouter: { slug: "openai/gpt-oss-120b" },
    supported_features: ["tools", "structured_outputs", "reasoning"],
  }, undefined);

  expect(synced).not.toHaveProperty("base_model");
  expect(synced).toMatchObject({
    name: "gpt-oss-120b",
    family: "gpt-oss",
    open_weights: true,
    tool_call: true,
    structured_output: true,
    reasoning: true,
  });
});

test("Ambient preserves existing name and dates on full models", () => {
  const fullModel: AmbientModel = {
    ...catalogModel,
    id: "openai/gpt-oss-120b",
    name: "gpt-oss-120b",
    openrouter: { slug: "openai/gpt-oss-120b" },
  };
  const full = buildAmbientModel(fullModel, undefined);
  if ("base_model" in full) throw new Error("Expected a full provider model fixture");

  const synced = buildAmbientModel(fullModel, {
    name: "Curated Name",
    release_date: "2025-01-01",
    last_updated: "2025-02-02",
  });

  expect(synced).toMatchObject({
    name: "Curated Name",
    release_date: "2025-01-01",
    last_updated: "2025-02-02",
  });
});

test("Ambient skips no models and rejects malformed responses", () => {
  // translateModel never drops a source model (no skip path).
  const translated = ambient.translateModel(catalogModel, { existing: () => undefined });
  expect(translated?.id).toBe("zai-org/GLM-5.1-FP8");
  expect(() => AmbientResponse.parse({ data: [{ id: "broken" }] })).toThrow();
});

test("Ambient base_model overlays reference existing canonical metadata and never override the name", async () => {
  const root = path.join(import.meta.dirname, "..", "..", "..");
  const modelsDir = path.join(root, "providers", "ambient", "models");

  let seen = 0;
  for await (const relativePath of new Bun.Glob("**/*.toml").scan({ cwd: modelsDir })) {
    seen++;
    const model = Bun.TOML.parse(await Bun.file(path.join(modelsDir, relativePath)).text()) as {
      base_model?: string;
      name?: string;
    };
    if (model.base_model === undefined) continue;
    expect(model.base_model.startsWith("ambient/"), relativePath).toBe(false);
    expect(
      await Bun.file(path.join(root, "models", `${model.base_model}.toml`)).exists(),
      relativePath,
    ).toBe(true);
    // Overlays inherit the canonical display name; Ambient's API name is not authoritative.
    expect(model.name, relativePath).toBeUndefined();
  }
  expect(seen).toBeGreaterThan(0);
});
