/**
 * compat-text.js
 * Compatibility layer for Text Completion API settings.
 * Reads from SillyTavern's textgenerationwebui_settings (exposed as ctx.textCompletionSettings)
 * and the global max_context variable (exposed as ctx.maxContext).
 *
 * IMPORTANT: SillyTavern's generateRaw() internally calls getTextGenGenerationData()
 * (textgen-settings.js:L1842) which delegates to createTextGenGenerationData()
 * (textgen-settings.js:L1586). That function maps ALL sampler settings from the
 * active textgenerationwebui_settings into the API payload, including:
 *   - Samplers: temp, top_p, top_k, min_p, typical_p, tfs, rep_pen, etc.
 *   - Bans: getCustomTokenBans() (textgen-settings.js:L438)
 *   - Logit bias: calculateLogitBias() (textgen-settings.js:L517)
 *   - Stopping strings: getStoppingStrings() (script.js:L2946)
 *   - Backend-specific params (Mirostat, DRY, XTC, etc.)
 *
 * Polyceph does NOT need to replicate any of that. This module only provides:
 *   1. Active limit introspection (context size, response length) for prompt budgeting.
 *   2. Feature flag reading (instruct mode, streaming) for Polyceph decisions.
 *
 * Reference:
 *   textgenerationwebui_settings   — textgen-settings.js:L143-236 (defaults)
 *   createTextGenGenerationData()  — textgen-settings.js:L1586 (full param builder)
 *   getTextGenGenerationData()     — textgen-settings.js:L1842 (wrapper + event emit)
 *   getCustomTokenBans()           — textgen-settings.js:L438
 *   calculateLogitBias()           — textgen-settings.js:L517
 *   st-context.js:L223             — textCompletionSettings = textgenerationwebui_settings
 *   st-context.js:L130             — maxContext = max_context
 */

import { MODULE_NAME } from './constants.js';

/**
 * Reads the active Text Completion generation parameters from SillyTavern.
 * These reflect the CURRENTLY SELECTED preset, not defaults.
 *
 * The ctx.textCompletionSettings object is a LIVE reference to
 * textgenerationwebui_settings, which is mutated in-place when the user
 * selects a new preset via selectPreset() → setSettingByName().
 *
 * ctx.maxContext is a live snapshot of the global `max_context` variable,
 * which is also updated by setGenerationParamsFromPreset().
 *
 * @returns {object} Text Completion parameters from the active preset.
 */
export function getTextCompletionParams() {
    const ctx = SillyTavern.getContext();
    const textSettings = ctx.textCompletionSettings;

    // max_context is set by setGenerationParamsFromPreset() when a preset is loaded,
    // and exposed via ctx.maxContext (st-context.js:L130)
    const maxContext = Number(ctx.maxContext) || 2048;

    // amount_gen is the global for response length. It's set alongside max_context
    // by setGenerationParamsFromPreset(). Read from DOM as it's not on the context object.
    let maxResponseTokens = 200;
    const amountGenEl = document.getElementById('amount_gen');
    if (amountGenEl) {
        const val = Number(amountGenEl.value);
        if (val > 0) maxResponseTokens = val;
    }

    return {
        // --- Limits (used by Polyceph for budgeting) ---
        maxContextTokens: maxContext,
        maxResponseTokens: maxResponseTokens,

        // --- Backend type ---
        type: textSettings?.type || 'ooba',
        presetName: textSettings?.preset || '',

        // --- Instruct Mode (used by Polyceph to understand prompt formatting) ---
        instructEnabled: !!ctx.powerUserSettings?.instruct?.enabled,
        instructPreset: ctx.powerUserSettings?.instruct?.preset || '',

        // --- Sampling (informational — ST applies these internally) ---
        temperature: Number(textSettings?.temp) ?? 0.7,
        topP: Number(textSettings?.top_p) ?? 0.5,
        topK: Number(textSettings?.top_k) ?? 40,
        minP: Number(textSettings?.min_p) ?? 0,
        topA: Number(textSettings?.top_a) ?? 0,
        typicalP: Number(textSettings?.typical_p) ?? 1,
        tfs: Number(textSettings?.tfs) ?? 1,
        repPen: Number(textSettings?.rep_pen) ?? 1.2,
        repPenRange: Number(textSettings?.rep_pen_range) ?? 0,
        freqPen: Number(textSettings?.freq_pen) ?? 0,
        presencePen: Number(textSettings?.presence_pen) ?? 0,
        seed: Number(textSettings?.seed) ?? -1,

        // --- Mirostat (informational) ---
        mirostatMode: Number(textSettings?.mirostat_mode) ?? 0,
        mirostatTau: Number(textSettings?.mirostat_tau) ?? 5,
        mirostatEta: Number(textSettings?.mirostat_eta) ?? 0.1,

        // --- Feature flags ---
        stream: !!textSettings?.streaming,
        skipSpecialTokens: textSettings?.skip_special_tokens !== false,
        includeReasoning: !!textSettings?.include_reasoning,
    };
}

/**
 * Gets the effective max prompt tokens for Text Completion.
 * This is context window minus reserved response tokens.
 *
 * @returns {number} Maximum prompt tokens for Text Completion.
 */
export function getTextCompletionMaxPromptTokens() {
    const params = getTextCompletionParams();
    return params.maxContextTokens - params.maxResponseTokens;
}
