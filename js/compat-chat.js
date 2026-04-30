/**
 * compat-chat.js
 * Compatibility layer for Chat Completion API settings.
 * Reads from SillyTavern's oai_settings (exposed as ctx.chatCompletionSettings).
 *
 * IMPORTANT: SillyTavern's generateRaw() internally dispatches to sendOpenAIRequest(),
 * which calls createGenerationParameters() (openai.js:L2529) to build the full API
 * payload from the active preset. This means ALL sampler settings (temperature, top_p,
 * penalties, logit bias, stop strings, reasoning effort, etc.) are applied by ST
 * automatically — Polyceph does NOT need to pass them.
 *
 * This module provides:
 *   1. Active limit introspection (context size, response length) for prompt budgeting.
 *   2. Feature flag reading (streaming, reasoning) for Polyceph UI/logic decisions.
 *
 * Reference:
 *   oai_settings definition       — openai.js:L389-490 (default_settings)
 *   createGenerationParameters()  — openai.js:L2529 (maps oai_settings → API payload)
 *   calculateLogitBias()          — openai.js:L3166 (processes bias presets)
 *   st-context.js:L222            — chatCompletionSettings = oai_settings
 */

import { MODULE_NAME } from './constants.js';
import { logger } from './logger.js';

/**
 * Reads the active Chat Completion generation parameters from SillyTavern.
 * These reflect the CURRENTLY SELECTED preset, not defaults.
 *
 * The ctx.chatCompletionSettings object is a LIVE reference to oai_settings,
 * which is mutated in-place when the user selects a new preset. No manual
 * refresh is needed.
 *
 * @returns {object} Chat Completion parameters from the active preset.
 */
export function getChatCompletionParams() {
    const ctx = SillyTavern.getContext();
    const cc = ctx.chatCompletionSettings;

    if (!cc) {
        logger.warn('chatCompletionSettings not available.');
        return {};
    }

    return {
        // --- Limits (used by Polyceph for budgeting) ---
        maxContextTokens: Number(cc.openai_max_context) || 4096,
        maxResponseTokens: Number(cc.openai_max_tokens) || 300,
        unlockedContext: !!cc.max_context_unlocked,

        // --- Model identification ---
        model: typeof ctx.getChatCompletionModel === 'function'
            ? ctx.getChatCompletionModel(cc)
            : (cc.openai_model || cc.claude_model || cc.google_model || ''),
        chatCompletionSource: cc.chat_completion_source || '',
        presetName: cc.preset_settings_openai || '',

        // --- Sampling (informational — ST applies these internally) ---
        temperature: Number(cc.temp_openai) ?? 1,
        topP: Number(cc.top_p_openai) ?? 1,
        topK: Number(cc.top_k_openai) ?? 0,
        minP: Number(cc.min_p_openai) ?? 0,
        topA: Number(cc.top_a_openai) ?? 0,
        frequencyPenalty: Number(cc.freq_pen_openai) ?? 0,
        presencePenalty: Number(cc.pres_pen_openai) ?? 0,
        repetitionPenalty: Number(cc.repetition_penalty_openai) ?? 1,
        seed: Number(cc.seed) ?? -1,

        // --- Feature flags (used by Polyceph for behavior decisions) ---
        stream: !!cc.stream_openai,
        showThoughts: !!cc.show_thoughts,
        reasoningEffort: cc.reasoning_effort || 'auto',
        verbosity: cc.verbosity || 'auto',
        mediaInlining: !!cc.media_inlining,
        inlineImageQuality: cc.inline_image_quality || 'auto',
    };
}

/**
 * Gets the effective max prompt tokens for Chat Completion.
 * This is context window minus reserved response tokens.
 *
 * @returns {number} Maximum prompt tokens for Chat Completion.
 */
export function getChatCompletionMaxPromptTokens() {
    const params = getChatCompletionParams();
    return params.maxContextTokens - params.maxResponseTokens;
}
