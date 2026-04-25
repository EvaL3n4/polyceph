/**
 * compat-shared.js
 * Shared compatibility utilities for reading SillyTavern's active settings.
 * Covers stopping strings, token counting, and context limits that apply
 * regardless of whether Chat Completion or Text Completion API is in use.
 *
 * IMPORTANT DESIGN NOTE:
 * SillyTavern's generateRaw() internally calls createGenerationParameters() (Chat)
 * or getTextGenGenerationData() (Text), which already apply ALL sampler settings
 * (temperature, top_p, penalties, logit bias, banned tokens, etc.) from the active
 * preset. Polyceph does NOT need to replicate that logic.
 *
 * This module only provides utilities that Polyceph needs for its OWN decisions:
 *   1. Token budgeting — to warn or truncate before sending.
 *   2. Stopping string post-processing — to clean leaked stops from output.
 *   3. Active limits — to pass responseLength overrides to generateRaw.
 *
 * Reference:
 *   getStoppingStrings()             — script.js:L2946
 *   getCustomStoppingStrings()       — power-user.js:L3081
 *   getInstructStoppingSequences()   — instruct-mode.js:L301
 *   getMaxContextTokens()            — script.js:L5840
 *   getMaxResponseTokens()           — script.js:L5877
 *   getMaxPromptTokens()             — script.js:L5892
 *   createGenerationParameters()     — openai.js:L2529  (Chat: auto-applied by ST)
 *   getTextGenGenerationData()       — textgen-settings.js:L1842 (Text: auto-applied by ST)
 *   createTextGenGenerationData()    — textgen-settings.js:L1586 (Text: actual param builder)
 */

import { MODULE_NAME } from './constants.js';

// ---------------------------------------------------------------------------
// Stopping Strings
// ---------------------------------------------------------------------------

/**
 * Retrieves the effective stopping strings from SillyTavern's active settings.
 * Mirrors the logic of getStoppingStrings() in script.js:L2946.
 *
 * For Chat Completion (openai): only custom stopping strings apply.
 * For Text Completion: custom + instruct sequence + name-based stops.
 *
 * @returns {string[]} Array of unique, non-empty stopping strings.
 */
export function getEffectiveStoppingStrings() {
    const ctx = SillyTavern.getContext();
    const api = ctx.mainApi;
    const powerUser = ctx.powerUserSettings;

    // Chat Completion only uses custom stopping strings (script.js:L2948-2949)
    if (api === 'openai') {
        return getCustomStoppingStrings(powerUser);
    }

    const result = [];

    // 1. Name-based stopping strings (script.js:L2954-2977)
    if (powerUser?.context?.names_as_stop_strings) {
        const charString = `\n${ctx.name2}:`;
        const userString = `\n${ctx.name1}:`;
        result.push(userString, charString);
    }

    // 2. Instruct stopping sequences (instruct-mode.js:L301-367)
    result.push(...getInstructStoppingSequences(ctx, powerUser));

    // 3. Custom stopping strings (power-user.js:L3081-3123)
    result.push(...getCustomStoppingStrings(powerUser));

    // 4. Single-line mode
    if (powerUser?.single_line) {
        result.unshift('\n');
    }

    // Deduplicate and filter
    return result.filter(x => x).filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Parses the custom stopping strings from power_user settings.
 * Mirrors power-user.js:L3081-3123.
 *
 * @param {object} powerUser - The power_user settings object.
 * @returns {string[]} Parsed custom stopping strings.
 */
function getCustomStoppingStrings(powerUser) {
    try {
        if (!powerUser?.custom_stopping_strings) return [];

        let strings = JSON.parse(powerUser.custom_stopping_strings);
        if (!Array.isArray(strings)) return [];

        strings = strings.filter(s => typeof s === 'string' && s.length > 0);

        // Macro substitution (power-user.js:L3101-3103)
        if (powerUser.custom_stopping_strings_macro) {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.substituteParams === 'function') {
                strings = strings.map(x => ctx.substituteParams(x));
            }
        }

        return strings;
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Error parsing custom stopping strings:`, error);
        return [];
    }
}

/**
 * Extracts instruct-mode stopping sequences.
 * Mirrors instruct-mode.js:L301-367.
 *
 * @param {object} ctx - SillyTavern context.
 * @param {object} powerUser - The power_user settings object.
 * @returns {string[]} Instruct stopping sequences.
 */
function getInstructStoppingSequences(ctx, powerUser) {
    const instruct = powerUser?.instruct;
    if (!instruct || !instruct.enabled) return [];

    const result = [];
    const substituteParams = typeof ctx.substituteParams === 'function' ? ctx.substituteParams : (x => x);

    const addSequence = (sequence) => {
        if (typeof sequence !== 'string' || sequence.trim().length === 0) return;
        const wrapped = instruct.wrap ? '\n' + sequence : sequence;
        const stopString = instruct.macro ? substituteParams(wrapped) : wrapped;
        result.push(stopString);
    };

    const stopSequence = instruct.stop_sequence || '';
    const inputSequence = (instruct.input_sequence || '').replace(/{{name}}/gi, ctx.name1 || '');
    const outputSequence = (instruct.output_sequence || '').replace(/{{name}}/gi, ctx.name2 || '');
    const firstOutputSequence = (instruct.first_output_sequence || '').replace(/{{name}}/gi, ctx.name2 || '');
    const lastOutputSequence = (instruct.last_output_sequence || '').replace(/{{name}}/gi, ctx.name2 || '');
    const systemSequence = (instruct.system_sequence || '').replace(/{{name}}/gi, 'System');
    const lastSystemSequence = (instruct.last_system_sequence || '').replace(/{{name}}/gi, 'System');

    const combined = [stopSequence];

    if (instruct.sequences_as_stop_strings) {
        combined.push(
            inputSequence, outputSequence,
            firstOutputSequence, lastOutputSequence,
            systemSequence, lastSystemSequence,
        );
    }

    combined.join('\n').split('\n')
        .filter((v, i, a) => a.indexOf(v) === i) // onlyUnique
        .forEach(addSequence);

    // Context-level stop strings (chat_start, example_separator)
    if (powerUser?.context?.use_stop_strings) {
        if (powerUser.context.chat_start) {
            result.push(`\n${substituteParams(powerUser.context.chat_start)}`);
        }
        if (powerUser.context.example_separator) {
            result.push(`\n${substituteParams(powerUser.context.example_separator)}`);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Token & Context Limits
// ---------------------------------------------------------------------------

/**
 * Gets the maximum context token limit for the active API.
 * Mirrors script.js:L5840-5871.
 *
 * Reads from the LIVE settings objects (oai_settings / max_context) which
 * reflect the currently selected preset, not defaults.
 *
 * @returns {number} Maximum context tokens.
 */
export function getMaxContextTokens() {
    const ctx = SillyTavern.getContext();
    const api = ctx.mainApi;

    if (api === 'openai') {
        // oai_settings.openai_max_context is the active preset's value
        return Number(ctx.chatCompletionSettings?.openai_max_context) || 4096;
    }

    // For text completion APIs, max_context is the global variable
    // which is updated when a preset is loaded (setGenerationParamsFromPreset)
    return Number(ctx.maxContext) || 2048;
}

/**
 * Gets the maximum response token limit for the active API.
 * Mirrors script.js:L5877-5885.
 *
 * @returns {number} Maximum response tokens.
 */
export function getMaxResponseTokens() {
    const ctx = SillyTavern.getContext();
    const api = ctx.mainApi;

    if (api === 'openai') {
        return Number(ctx.chatCompletionSettings?.openai_max_tokens) || 300;
    }

    // For text completion, amount_gen is the global for response length.
    // It's not directly on the context object, but textCompletionSettings
    // has max_length (from the preset) and max_new_tokens (from getTextGenGenerationData).
    // ctx.maxContext is the context size. We need amount_gen which isn't directly exposed,
    // but we can read it from the text completion preset settings.
    const textSettings = ctx.textCompletionSettings;
    // textgenerationwebui_settings doesn't store max_length directly,
    // but selectPreset() calls setGenerationParamsFromPreset() which sets amount_gen.
    // The UI field #amount_gen_textarea has the value. We can read it from the DOM.
    const amountGenEl = document.getElementById('amount_gen');
    if (amountGenEl) {
        const val = Number(amountGenEl.value);
        if (val > 0) return val;
    }

    return 200; // Safe default
}

/**
 * Gets the maximum usable prompt token size (context minus response reservation).
 * Mirrors script.js:L5892-5898.
 *
 * @param {number} [overrideResponseLength] Optional override for response length.
 * @returns {number} Maximum prompt tokens.
 */
export function getMaxPromptTokens(overrideResponseLength = null) {
    const responseTokens = (typeof overrideResponseLength === 'number' && overrideResponseLength > 0)
        ? overrideResponseLength
        : getMaxResponseTokens();
    return getMaxContextTokens() - responseTokens;
}

/**
 * Counts the number of tokens in a given text or message array using ST's tokenizer.
 *
 * @param {string | object[]} content - Text string or array of {role, content} messages.
 * @returns {Promise<number>} Token count.
 */
export async function countTokens(content) {
    const ctx = SillyTavern.getContext();

    if (typeof ctx.getTokenCountAsync === 'function') {
        if (typeof content === 'string') {
            return await ctx.getTokenCountAsync(content);
        }
        // For message arrays, count the combined content
        const text = content.map(m => m.content || '').join('\n');
        return await ctx.getTokenCountAsync(text);
    }

    // Fallback: rough estimation (4 chars per token)
    const text = typeof content === 'string' ? content : content.map(m => m.content || '').join('\n');
    return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Active API Detection
// ---------------------------------------------------------------------------

/**
 * Returns the active API type string ('openai', 'textgenerationwebui', 'kobold', 'novel').
 * @returns {string} The active main API.
 */
export function getActiveApi() {
    return SillyTavern.getContext().mainApi || 'openai';
}

/**
 * Returns true if the active API is a Chat Completion API (OpenAI-compatible).
 * @returns {boolean}
 */
export function isChatCompletionApi() {
    return getActiveApi() === 'openai';
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Sends a message array to SillyTavern's generation API with version fallbacks.
 * Wraps the generateRaw → generateQuietPrompt → slash command fallback chain.
 *
 * @param {object[]} messages - Array of {role, content} message objects.
 * @returns {Promise<string>} The generated response text.
 * @throws {Error} If no generation function is available.
 */
export async function generateViaApi(messages) {
    const context = SillyTavern.getContext();

    if (typeof context.generateRaw === 'function') {
        return await context.generateRaw({ prompt: messages, systemPrompt: '' });
    }

    if (typeof context.generateQuietPrompt === 'function') {
        console.warn(`[${MODULE_NAME}] generateRaw not found, falling back to generateQuietPrompt.`);
        // generateQuietPrompt doesn't support arrays natively in all versions,
        // so we pass the flattened string. ST will wrap it in 'user' role.
        const flattened = messages.map(m => m.content).join('\n\n');
        return await context.generateQuietPrompt({ quietPrompt: flattened });
    }

    console.warn(`[${MODULE_NAME}] generateQuietPrompt not found, falling back to slash command.`);
    const flattened = messages.map(m => m.content).join('\n\n');
    const escaped = flattened.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const result = await context.executeSlashCommandsWithOptions(`/gen ${escaped}`, {
        handleExecutionErrors: false, handleParserErrors: false
    });
    return result;
}

// ---------------------------------------------------------------------------
// Chat Message Helpers
// ---------------------------------------------------------------------------

/**
 * Posts a message to SillyTavern's chat, handling addOneMessage, saveChat, and event emission.
 *
 * @param {object} options
 * @param {string} options.content - The message text.
 * @param {string} [options.name='Assistant'] - Display name for the message.
 * @param {boolean} [options.isUser=false] - Whether this is a user message.
 * @param {string} [options.forceAvatar=''] - Avatar URL override.
 * @param {object} [options.extra={}] - Extra metadata to attach.
 * @param {boolean} [options.save=true] - Whether to call saveChat after posting.
 * @returns {number} The index of the posted message in the chat array.
 */
export function postMessageToChat({ content, name = 'Assistant', isUser = false, forceAvatar = '', extra = {}, save = true }) {
    const ctx = SillyTavern.getContext();

    const msg = {
        name: name,
        is_user: isUser,
        is_system: false,
        send_date: typeof ctx.humanizedDateTime === 'function' ? ctx.humanizedDateTime() : new Date().toLocaleString(),
        mes: content,
        extra: extra,
    };

    if (forceAvatar) {
        msg.force_avatar = forceAvatar;
    }

    ctx.chat.push(msg);
    const messageIndex = ctx.chat.length - 1;

    if (typeof ctx.addOneMessage === 'function') {
        ctx.addOneMessage(msg);
    }

    if (ctx.eventSource && ctx.eventTypes) {
        ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, messageIndex);
    }

    if (save && typeof ctx.saveChat === 'function') {
        ctx.saveChat();
    }

    return messageIndex;
}

// ---------------------------------------------------------------------------
// World Info / Lorebook
// ---------------------------------------------------------------------------

/**
 * Fetches the World Info (Lorebook) prompt for the given chat history.
 * Wraps stContext.getWorldInfoPrompt() with the expected formatting.
 *
 * @param {object[]} chat - The SillyTavern chat array (filtered, no typing indicators).
 * @returns {Promise<string>} The resolved World Info prompt string.
 */
export async function getWorldInfoForChat(chat) {
    const ctx = SillyTavern.getContext();

    if (typeof ctx.getWorldInfoPrompt !== 'function') {
        console.warn(`[${MODULE_NAME}] getWorldInfoPrompt not available.`);
        return '';
    }

    // World Info expects a reversed array of strings (name: message)
    const chatForWI = chat.map(m => `${m.name}: ${m.mes}`).reverse();
    const wiResult = await ctx.getWorldInfoPrompt(chatForWI, ctx.maxContext, false);
    return wiResult?.worldInfoString || '';
}

// ---------------------------------------------------------------------------
// Character Info
// ---------------------------------------------------------------------------

/**
 * Gets the active character's name and avatar URL.
 *
 * @returns {{ name: string, avatarUrl: string }} Character display info.
 */
export function getActiveCharacterInfo() {
    const ctx = SillyTavern.getContext();

    const name = ctx.characters?.[ctx.characterId]?.name || ctx.name2 || 'Assistant';

    let avatarUrl = '';
    if (typeof ctx.getThumbnailUrl === 'function' && ctx.characters?.[ctx.characterId]) {
        avatarUrl = ctx.getThumbnailUrl('avatar', ctx.characters[ctx.characterId].avatar);
    }

    return { name, avatarUrl };
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

/**
 * Gets the main system prompt from SillyTavern's Advanced Formatting settings.
 *
 * @returns {string} The main system prompt text.
 */
export function getMainSystemPrompt() {
    const ctx = SillyTavern.getContext();
    return ctx.extension_settings?.formatting?.main_prompt || '';
}
