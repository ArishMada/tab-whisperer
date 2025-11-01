// src/lib/gemini.ts

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

interface GenAITextPart {
  text?: string;
}
interface GenAIContent {
  parts?: GenAITextPart[];
}
interface GenAICandidate {
  content?: GenAIContent;
}
interface GenAIResponse {
  candidates?: GenAICandidate[];
}

interface ModelMeta {
  name: string; // e.g., "models/gemini-1.5-flash"
  displayName?: string;
  supportedGenerationMethods?: string[]; // e.g., ["generateContent", "countTokens"]
}

const MODELS_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models?key=${API_KEY}`;

// In order of preference
const PREFERRED_MODEL_IDS = [
  "models/gemini-1.5-flash-latest",
  "models/gemini-1.5-flash",
  "models/gemini-1.5-flash-8b-latest",
  "models/gemini-1.5-flash-8b",
  "models/gemini-1.5-pro-latest",
  "models/gemini-1.5-pro",
  "models/gemini-1.0-pro",
];

async function listModels(): Promise<ModelMeta[]> {
  const res = await fetch(MODELS_ENDPOINT, { method: "GET" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ListModels ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { models?: ModelMeta[] };
  return data.models ?? [];
}

function pickBestModel(models: ModelMeta[]): string {
  // Only consider those that support generateContent
  const allowed = new Set(
    models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name)
  );

  for (const desired of PREFERRED_MODEL_IDS) {
    if (allowed.has(desired)) return desired;
    // also try without "-latest" if caller listed with that alias
    if (desired.endsWith("-latest")) {
      const base = desired.replace("-latest", "");
      if (allowed.has(base)) return base;
    }
  }

  // Fallback to any model with generateContent
  const any = models.find((m) =>
    m.supportedGenerationMethods?.includes("generateContent")
  );
  if (!any) {
    throw new Error(
      "No Gemini model with generateContent is available for this API key/project."
    );
  }
  return any.name;
}

async function resolveUsableModel(): Promise<string> {
  const models = await listModels();
  return pickBestModel(models);
}

async function postGenerateContent(
  modelName: string,
  prompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini v1 ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GenAIResponse;
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p: GenAITextPart) => p.text ?? "")
      .join("") ?? "";
  return text;
}

/**
 * Summarize and group browser tabs by topic using Gemini API (REST).
 * Automatically discovers an available model and retries on 404.
 */
export async function summarizeTabs(
  tabs: { title: string; url: string }[],
  extraPrompt?: string
): Promise<string> {
  const tabList = tabs
    .map((t, i) => `${i + 1}. ${t.title} (${t.url})`)
    .join("\n");
  const prompt =
    `Summarize and group the following browser tabs by topic.\n\n` +
    `Tabs:\n${tabList}\n\n` +
    (extraPrompt ? `User request: ${extraPrompt}` : "");

  // 1) Try preferred model first (fast path): gemini-1.5-flash-latest
  let model = PREFERRED_MODEL_IDS[0]; // "models/gemini-1.5-flash-latest"

  try {
    return await postGenerateContent(model, prompt);
  } catch (e) {
    // If the error is a 404 (model not found / not supported), resolve available model and retry once
    const is404 =
      e instanceof Error &&
      /(^|[\s{"])404([\s}",]|$)/.test(e.message) &&
      /NOT_FOUND|is not found|not supported/.test(e.message);

    if (!is404) throw e; // other errors bubble up

    // 2) Discover and pick a model your key CAN use
    model = await resolveUsableModel();
    return await postGenerateContent(model, prompt);
  }
}

export async function groupTabsByIdStrict(
  items: { id: string; title: string }[]
): Promise<string> {
  const list = items
    .map((i) => `- id: ${i.id}\n  title: ${i.title}`)
    .join("\n");

  const prompt = `You are a strict JSON generator. Group the tabs by topic.

RULES:
- Return ONLY minified JSON, no markdown, no commentary.
- Shape: {"<GroupName>":["<tabId>", "..."], "..."}.
- Use at most 8 groups. Prefer short, human-readable names.
- Do NOT invent ids or titles. Use the provided ids exactly.
- If something doesn't fit a clear topic, put it in "Misc".
- Never include URLs.

TABS:
${list}

Return JSON now:`;

  // prefer flash; if 404, resolve a usable model (same pattern as summarizeTabs)
  let model = "models/gemini-1.5-flash-latest";
  try {
    return await postGenerateContent(model, prompt);
  } catch (e) {
    const is404 =
      e instanceof Error &&
      /(^|[\s{"])404([\s}",]|$)/.test(e.message) &&
      /NOT_FOUND|is not found|not supported/.test(e.message);
    if (!is404) throw e;
    model = await resolveUsableModel();
    return await postGenerateContent(model, prompt);
  }
}

export async function summarizePage(
  title: string,
  text: string,
  style: "bullets" | "blurb" = "bullets"
): Promise<string> {
  // Keep prompt tiny and deterministic
  const ask =
    style === "bullets"
      ? `Summarize the page in 3–5 crisp bullet points. No fluff, no headers.`
      : `Summarize in 2 short sentences. Be clear and factual.`;

  const prompt =
    `You are summarizing a single web page.\n` +
    `Title: ${title}\n\n` +
    `Content (truncated):\n` +
    text.slice(0, 8000) + // guard token size
    `\n\n${ask}`;

  // Prefer flash; fallback the same way as the others.
  let model = "models/gemini-1.5-flash-latest";
  try {
    return await postGenerateContent(model, prompt);
  } catch (e) {
    const is404 =
      e instanceof Error &&
      /(^|[\s{"])404([\s}",]|$)/.test(e.message) &&
      /NOT_FOUND|is not found|not supported/.test(e.message);
    if (!is404) throw e;
    model = await resolveUsableModel();
    return await postGenerateContent(model, prompt);
  }
}
