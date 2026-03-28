import { useEffect, useRef, useState } from "react";

const DEFAULT_CHAT_ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_FORGE_ENDPOINT = "http://127.0.0.1:7860/sdapi/v1/txt2img";
/** Default LM Studio model id (user can override). */
const DEFAULT_CHAT_MODEL = "mistral-nemo-instruct-2407";
const TRANSLATION_SYSTEM_PROMPT =
  "Turn the following text into a short, descriptive English Stable Diffusion prompt. Do not add any conversational text—output only the English prompt.";
const FORGE_PROMPT_SUFFIX = ", photorealistic, 8k, detailed, raw photo";

/** Forge / Automatic1111 txt2img — append path if the settings URL is only origin (e.g. tunnel base). */
function resolveForgeTxt2ImgUrl(raw) {
  const trimmed = (raw || DEFAULT_FORGE_ENDPOINT).trim();
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  if (/\/sdapi\/v1\/txt2img$/i.test(withoutTrailingSlashes)) {
    return withoutTrailingSlashes;
  }
  return `${withoutTrailingSlashes}/sdapi/v1/txt2img`;
}

const SYSTEM_MESSAGE = {
  role: "system",
  content: "You are a helpful and professional AI assistant. Answer concisely and clearly in English."
};
const STORAGE_KEY = "ai-dashboard-chat-history";
// uiOnly: true — shown in chat UI but never sent to the API
const WELCOME_MESSAGE = {
  role: "assistant",
  text: "Hello! I am your AI assistant. How can I help you today?",
  uiOnly: true
};

/** OpenAI-compatible /v1/chat/completions: system + user/assistant only, non-empty content. */
function buildChatApiMessages(uiMessages, newUserContent) {
  const history = uiMessages
    .filter(
      (m) =>
        !m.uiOnly &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.text === "string" &&
        m.text.trim().length > 0
    )
    .map((m) => ({
      role: m.role,
      content: m.text.trim()
    }));

  const userContent = typeof newUserContent === "string" ? newUserContent.trim() : "";
  const systemContent = String(SYSTEM_MESSAGE.content ?? "").trim();
  if (!systemContent) {
    throw new Error("System prompt is empty.");
  }

  const out = [{ role: "system", content: systemContent }, ...history];
  if (userContent) {
    out.push({ role: "user", content: userContent });
  }

  // Final safety filter — no empty content to the API
  return out.filter((m) => typeof m.content === "string" && m.content.trim().length > 0);
}

function extractAssistantTextFromCompletion(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(() => {
    try { return localStorage.getItem("ai-dashboard-model") || DEFAULT_CHAT_MODEL; } catch { return DEFAULT_CHAT_MODEL; }
  });
  const [chatEndpoint, setChatEndpoint] = useState(() => {
    try { return localStorage.getItem("ai-dashboard-chat-endpoint") || DEFAULT_CHAT_ENDPOINT; } catch { return DEFAULT_CHAT_ENDPOINT; }
  });
  const [forgeEndpoint, setForgeEndpoint] = useState(() => {
    try { return localStorage.getItem("ai-dashboard-forge-endpoint") || DEFAULT_FORGE_ENDPOINT; } catch { return DEFAULT_FORGE_ENDPOINT; }
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [WELCOME_MESSAGE];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [WELCOME_MESSAGE];
      const valid = parsed.filter(
        (message) =>
          !message?.uiOnly &&
          (message?.role === "user" || message?.role === "assistant") &&
          typeof message?.text === "string" &&
          message.text.trim().length > 0
      );
      return valid.length > 0 ? valid : [WELCOME_MESSAGE];
    } catch {
      return [WELCOME_MESSAGE];
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  // { src: string (data URL), prompt: string (original user prompt) }[]
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null); // { src, prompt } | null
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [mainTab, setMainTab] = useState("chat");
  const [serverStatus, setServerStatus] = useState("checking"); // "checking" | "online" | "offline"
  const [copiedIndex, setCopiedIndex] = useState(null);
  const chatContainerRef = useRef(null);

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    scrollChatToBottom();
  }, [messages, isGenerating]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    try { localStorage.setItem("ai-dashboard-model", chatModel); } catch {}
  }, [chatModel]);

  useEffect(() => {
    try { localStorage.setItem("ai-dashboard-chat-endpoint", chatEndpoint); } catch {}
  }, [chatEndpoint]);

  useEffect(() => {
    try { localStorage.setItem("ai-dashboard-forge-endpoint", forgeEndpoint); } catch {}
  }, [forgeEndpoint]);

  // Ping LM Studio on load and every 30s
  useEffect(() => {
    const check = async () => {
      const base = chatEndpoint.replace(/\/v1\/.*$/, "");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${base}/v1/models`, { signal: controller.signal });
        setServerStatus(res.ok ? "online" : "offline");
      } catch {
        setServerStatus("offline");
      } finally {
        clearTimeout(timeout);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [chatEndpoint]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const userText = input.trim();
    if (!userText || isGenerating) return;

    const endpoint = chatEndpoint.trim() || DEFAULT_CHAT_ENDPOINT;
    const model   = chatModel.trim()    || DEFAULT_CHAT_MODEL;

    // ── Build payload ─────────────────────────────────────────────────────────
    // 1) Filter state: no uiOnly, no empty texts
    const historyMessages = messages
      .filter(
        (m) =>
          !m.uiOnly &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.text === "string" &&
          m.text.trim().length > 0
      )
      .map((m) => ({ role: m.role, content: m.text.trim() }));

    // 2) system → history → new user message
    const apiMessages = [
      { role: "system", content: SYSTEM_MESSAGE.content.trim() },
      ...historyMessages,
      { role: "user", content: userText },
    // 3) Safety filter — no empty content
    ].filter((m) => typeof m.content === "string" && m.content.trim() !== "");

    // ── Update state after payload is ready ───────────────────────────────────
    setInput("");
    setError("");
    setIsGenerating(true);
    setMessages((prev) => [...prev, { role: "user", text: userText }]);

    try {
      const body = {
        model,
        stream: false,
        messages: apiMessages,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1000
      };
      console.log("Sending request:", JSON.stringify(body, null, 2));

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          detail += " — " + JSON.stringify(errBody);
        } catch { /* error body may not be JSON */ }
        console.error("API error:", detail);
        throw new Error(`Server returned ${response.status} — check the console (F12).`);
      }

      const data = await response.json();
      console.log("API response:", data);

      const assistantText = extractAssistantTextFromCompletion(data);
      if (!assistantText) {
        console.error("Empty content in response:", data);
        throw new Error("The model returned an empty reply — check the console (F12).");
      }

      setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      scrollChatToBottom();
    } catch (err) {
      console.error("handleSubmit error:", err);
      setError(err instanceof Error ? err.message : "Unknown error — check the console (F12).");
    } finally {
      setIsGenerating(false);
      scrollChatToBottom();
    }
  };

  const handleClearHistory = () => {
    setMessages([WELCOME_MESSAGE]);
    setError("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  };

  const handleGenerateImage = async (event) => {
    event.preventDefault();
    const promptText = imagePrompt.trim();
    if (!promptText || isGeneratingImage) return;

    setIsGeneratingImage(true);
    setImageError("");

    try {
      const translationResponse = await fetch(chatEndpoint.trim() || DEFAULT_CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: chatModel.trim() || DEFAULT_CHAT_MODEL,
          stream: false,
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: TRANSLATION_SYSTEM_PROMPT
            },
            {
              role: "user",
              content: promptText
            }
          ]
        })
      });

      if (!translationResponse.ok) {
        throw new Error(`Translation request failed with ${translationResponse.status}`);
      }

      const translationData = await translationResponse.json();
      const translatedPrompt = extractAssistantTextFromCompletion(translationData);
      if (!translatedPrompt) {
        throw new Error("LM Studio did not return a valid prompt translation.");
      }

      const enhancedPrompt = `${translatedPrompt}${FORGE_PROMPT_SUFFIX}`;
      const forgeUrl = resolveForgeTxt2ImgUrl(forgeEndpoint);
      const forgeBody = {
        prompt: enhancedPrompt,
        steps: 20,
        width: 512,
        height: 512
      };
      const response = await fetch(forgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Bypass-Tunnel-Reminder": "true"
        },
        body: JSON.stringify(forgeBody)
      });

      if (!response.ok) {
        throw new Error(`Forge returned error ${response.status}`);
      }

      const data = await response.json();
      const firstImage = Array.isArray(data?.images) ? data.images[0] : "";
      if (!firstImage) {
        throw new Error("Forge returned no image.");
      }

      const nextEntry = { src: `data:image/png;base64,${firstImage}`, prompt: promptText };
      setGeneratedImages((prev) => [...prev, nextEntry]);
      setSelectedImage(nextEntry);
    } catch (generateError) {
      setImageError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to generate image."
      );
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-slate-950 text-slate-100">
      {/* Floating layout wrapper */}
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:flex-row">

        {/* ── Sidebar (settings) ───────────────────────────────────────────── */}
        <aside className="w-full shrink-0 overflow-y-auto rounded-2xl border border-slate-800/60 bg-slate-900 p-6 shadow-2xl shadow-slate-950/70 md:w-80">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-base">🤖</span>
            <h1 className="text-lg font-semibold tracking-tight text-slate-50">AI Dashboard</h1>
          </div>
          <p className="mt-2 text-xs text-slate-500">Local AI assistant • LM Studio + Forge</p>

          <h2 className="mt-7 text-xs font-semibold uppercase tracking-wider text-slate-500">Settings</h2>
          <div className="mt-3 space-y-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="api-key">
                API key
              </label>
              <input
                id="api-key"
                type="password"
                placeholder="Enter your API key…"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className="w-full rounded-xl border border-slate-700/70 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 shadow-inner transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
              <p className="mt-1.5 text-[11px] text-slate-600">Optional — only required for protected endpoints.</p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="chat-model">
                Model (LM Studio)
              </label>
              <input
                id="chat-model"
                type="text"
                placeholder="e.g. mistral-nemo-instruct-2407 or your loaded model…"
                value={chatModel}
                onChange={(event) => setChatModel(event.target.value)}
                className="w-full rounded-xl border border-slate-700/70 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 shadow-inner transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
          </div>

          <div className="mt-7 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Endpoints</h2>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-indigo-400" htmlFor="chat-endpoint">
                Chat — LM Studio
              </label>
              <input
                id="chat-endpoint"
                type="text"
                value={chatEndpoint}
                onChange={(event) => setChatEndpoint(event.target.value)}
                className="w-full rounded-xl border border-slate-700/70 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-400 shadow-inner transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-fuchsia-400" htmlFor="forge-endpoint">
                Image generator — Forge
              </label>
              <input
                id="forge-endpoint"
                type="text"
                value={forgeEndpoint}
                onChange={(event) => setForgeEndpoint(event.target.value)}
                className="w-full rounded-xl border border-slate-700/70 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-400 shadow-inner transition focus:border-fuchsia-500/50 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
              />
            </div>
          </div>
        </aside>

        {/* ── Main panel ───────────────────────────────────────────────────── */}
        <main className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6 shadow-xl shadow-slate-950/50 backdrop-blur md:p-8">

          {/* Tabs */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl border border-slate-700/60 bg-slate-950/60 p-1.5 shadow-inner">
              <button
                type="button"
                onClick={() => setMainTab("chat")}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  mainTab === "chat"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/50"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                }`}
              >
                <span>💬</span> Chat
              </button>
              <button
                type="button"
                onClick={() => setMainTab("generator")}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  mainTab === "generator"
                    ? "bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-950/50"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                }`}
              >
                <span>🎨</span> Image Generator
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Connection status */}
              <div className="flex flex-col items-end gap-0.5">
                {serverStatus === "checking" && (
                  <span
                    title="Local connection status"
                    className="flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-400"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                    Checking connection…
                  </span>
                )}
                {serverStatus === "online" && (
                  <span
                    title="Local connection status"
                    className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Online
                  </span>
                )}
                {serverStatus === "offline" && (
                  <span
                    title="Local connection status"
                    className="flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                    Offline (demo)
                  </span>
                )}
                <span className="max-w-[11rem] text-right text-[10px] leading-tight text-slate-500">
                  Local connection status
                </span>
              </div>
              {mainTab === "chat" && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={isGenerating}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  🗑 Clear history
                </button>
              )}
              {mainTab === "generator" && (
                <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-medium text-fuchsia-300">
                  🌐 Auto prompt → Forge
                </span>
              )}
            </div>
          </div>

          {/* ── Chat tab ─────────────────────────────────────────────────── */}
          {mainTab === "chat" && (
            <>
              {serverStatus === "offline" && (
                <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  <span className="mt-0.5 shrink-0 text-base">⚠️</span>
                  <span>
                    <strong className="font-semibold">Visual demo — servers unavailable.</strong>{" "}
                    Run local LM Studio and Forge for full AI chat.
                  </span>
                </div>
              )}
              <div
                ref={chatContainerRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4 shadow-inner"
              >
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === "assistant"
                        ? "border border-slate-700/60 bg-slate-800/70 text-slate-100 shadow-sm"
                        : "ml-auto border border-indigo-500/30 bg-indigo-600/15 text-indigo-100 shadow-sm shadow-indigo-950/20"
                    }`}
                  >
                    {message.text}
                  </div>
                ))}
                {isGenerating && (
                  <div className="inline-flex items-center gap-2.5 rounded-2xl border border-slate-700/60 bg-slate-800/70 px-4 py-2.5 text-xs text-slate-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                    Assistant is typing…
                  </div>
                )}
                {error && (
                  <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                    ⚠️ {error}
                  </div>
                )}
              </div>

              <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={isGenerating}
                  className="flex-1 rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="rounded-2xl bg-indigo-600 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating ? "Sending…" : "Send ↵"}
                </button>
              </form>
            </>
          )}

          {/* ── Image generator tab ───────────────────────────────────────── */}
          {mainTab === "generator" && (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
              {serverStatus === "offline" && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  <span className="mt-0.5 shrink-0 text-base">⚠️</span>
                  <span>
                    <strong className="font-semibold">Visual demo — servers unavailable.</strong>{" "}
                    Start LM Studio and Stable Diffusion Forge to generate images.
                  </span>
                </div>
              )}
              <section className="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 shadow-lg shadow-slate-950/30">
                <h2 className="text-lg font-semibold text-slate-50">Image generator</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Describe your image in plain language — it is converted to an English Stable Diffusion prompt and sent to Forge with quality-enhancing suffixes.
                </p>
                <form className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleGenerateImage}>
                  <div className="min-w-0 flex-1">
                    <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="image-prompt">
                      Image description
                    </label>
                    <input
                      id="image-prompt"
                      type="text"
                      placeholder="e.g. a dog in space, digital painting…"
                      value={imagePrompt}
                      onChange={(event) => setImagePrompt(event.target.value)}
                      disabled={isGeneratingImage}
                      className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 transition focus:border-fuchsia-500/50 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isGeneratingImage}
                    className={`shrink-0 rounded-2xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 active:scale-95 disabled:cursor-not-allowed
                      ${isGeneratingImage
                        ? "animate-pulse cursor-not-allowed bg-fuchsia-700 shadow-[0_0_20px_4px_rgba(192,38,211,0.35)]"
                        : "bg-fuchsia-600 shadow-lg shadow-fuchsia-950/40 hover:bg-fuchsia-500 hover:shadow-[0_0_16px_2px_rgba(192,38,211,0.25)]"
                      }`}
                  >
                    <span className="flex items-center gap-2">
                      {isGeneratingImage ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Generating…
                        </>
                      ) : (
                        <>🎨 Generate</>
                      )}
                    </span>
                  </button>
                </form>
                {imageError && (
                  <div className="mt-4 rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    ⚠️ {imageError}
                  </div>
                )}
              </section>

              {/* Gallery */}
              <section className="rounded-2xl border border-slate-800/60 bg-slate-950/30 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-100">Generated images</h3>
                  <span className="text-xs text-slate-500">
                    {generatedImages.length > 0 ? `${Math.min(generatedImages.length, 12)} images` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">Click to preview • Hover for actions</p>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {generatedImages.length === 0 && !isGeneratingImage && (
                    <p className="col-span-full rounded-2xl border border-dashed border-slate-700/50 bg-slate-950/20 py-12 text-center text-sm text-slate-500">
                      No images yet. Start Forge and generate your first one!
                    </p>
                  )}
                  {isGeneratingImage && (
                    <div className="aspect-square animate-pulse rounded-2xl border border-fuchsia-500/20 bg-slate-800/60">
                      <div className="flex h-full items-center justify-center">
                        <svg className="h-6 w-6 animate-spin text-fuchsia-500/40" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {generatedImages
                    .slice(-12)
                    .reverse()
                    .map((entry, index) => (
                      <div
                        key={`${entry.src.slice(0, 24)}-${index}`}
                        className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950 shadow-md transition-all duration-300 hover:scale-105 hover:border-fuchsia-500/50 hover:shadow-xl hover:shadow-fuchsia-950/25"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedImage(entry)}
                          className="block w-full"
                        >
                          <img
                            src={entry.src}
                            alt={entry.prompt}
                            className="aspect-square w-full object-cover transition-all duration-300 group-hover:brightness-50"
                          />
                        </button>
                        {/* Hover overlay */}
                        <div className="absolute inset-x-0 bottom-0 flex translate-y-1 items-center justify-center gap-2 p-2 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(entry.prompt).then(() => {
                                setCopiedIndex(index);
                                setTimeout(() => setCopiedIndex(null), 2000);
                              });
                            }}
                            title="Copy prompt"
                            className="flex items-center gap-1 rounded-xl border border-white/20 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-slate-800"
                          >
                            {copiedIndex === index ? "✓ Copied" : "📋 Prompt"}
                          </button>
                          <a
                            href={entry.src}
                            download={`ai-image-${index + 1}.png`}
                            onClick={(e) => e.stopPropagation()}
                            title="Download image"
                            className="flex items-center gap-1 rounded-xl border border-white/20 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-slate-800"
                          >
                            ⬇ Save
                          </a>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* ── Image preview modal ─────────────────────────────────────────── */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-h-[95vh] w-full max-w-4xl rounded-2xl border border-slate-700/60 bg-slate-900 p-4 shadow-2xl shadow-slate-950/80"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prompt</p>
                <p className="mt-0.5 truncate text-sm text-slate-300">{selectedImage.prompt}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(selectedImage.prompt)}
                  className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                >
                  📋 Copy prompt
                </button>
                <a
                  href={selectedImage.src}
                  download="ai-image.png"
                  className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20"
                >
                  ⬇ Download
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="rounded-xl border border-slate-600/60 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <img
              src={selectedImage.src}
              alt={selectedImage.prompt}
              className="mx-auto max-h-[80vh] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
