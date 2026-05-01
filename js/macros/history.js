import { logger } from './utils.js';

/**
 * Weaves extension-injected prompts into a message list based on depth and position.
 * Mimics SillyTavern's populationInjectionPrompts logic.
 */
export function weaveInjections(messages, extensionPrompts) {
    if (!extensionPrompts) return messages.map(m => ({ ...m, is_injection: false }));

    const injections = [];
    Object.keys(extensionPrompts).forEach(key => {
        const prompt = extensionPrompts[key];
        if (prompt && prompt.value && prompt.value.trim()) {
            injections.push({
                id: key,
                value: prompt.value.trim(),
                depth: Number(prompt.depth || 0),
                position: Number(prompt.position || 0), // 0: Before, 1: In-Chat
                role: Number(prompt.role || 0)
            });
        }
    });

    const finalMessages = [];
    // Loop backwards to match ST's depth logic (0 is last message)
    for (let i = messages.length - 1; i >= 0; i--) {
        const depth = messages.length - 1 - i;
        const msg = messages[i];

        // In-Chat Injections (Position 1) go AFTER the message at that depth (closer to bottom)
        injections.filter(inj => inj.depth === depth && inj.position === 1).forEach(inj => {
            finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
        });

        // The Message itself
        finalMessages.unshift({ ...msg, is_injection: false });

        // Before-Prompt Injections (Position 0)
        injections.filter(inj => inj.depth === depth && inj.position === 0).forEach(inj => {
            finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
        });
    }

    // Handle depths beyond chat length
    injections.filter(inj => inj.depth >= messages.length).forEach(inj => {
        finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
    });

    return finalMessages;
}

/**
 * Resolves Polyceph-specific chat history macros.
 * Handles: {{chat_history}}, {{chat_history:N}}, {{chat_history:live}}, {{chat_history:live:N}}
 * 
 * @param {string} text - The prompt text to process
 * @param {Array} cleanChat - Snapshot of the chat array without typing indicators
 * @param {object} stContext - SillyTavern context
 * @returns {string} - Processed text
 */
export function resolveChatHistory(text, cleanChat, stContext) {
    if (!text) return text;

    const isCC = stContext.mainApi === 'openai';

    // Regex for: {{chat_history|last:10|live:true|bg_last:2|no_extensions:true}}
    return text.replace(/\{\{chat_history(?:\|([^}]+))?\}\}/g, (match, params) => {
        const options = {};
        if (params) {
            params.split('|').forEach(p => {
                const [key, val] = p.split(':').map(s => s.trim().toLowerCase());
                if (key) options[key] = val;
            });
        }

        const includeInjections = options.no_extensions !== 'true';

        // 1. Select Source
        let source = (options.live === 'true') ?
            stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/')) :
            cleanChat;

        // 2. Filter Background Messages (preserve order)
        let filteredMessages = source;
        if (options.bg_last !== undefined) {
            const bgLimit = parseInt(options.bg_last);
            const backgroundMsgs = source.filter(m => m && m.extra?.polyceph_hidden);

            if (backgroundMsgs.length > bgLimit) {
                const keepBgs = backgroundMsgs.slice(-bgLimit);
                filteredMessages = source.filter(m => {
                    // Keep if not hidden OR if it's one of the last N hidden ones
                    if (!m.extra?.polyceph_hidden) return true;
                    return keepBgs.includes(m);
                });
            }
        }

        // 3 & 4. Map and Weave
        const finalMessages = weaveInjections(filteredMessages, includeInjections ? stContext.extensionPrompts : null);

        // 5. Format to strings
        let history = finalMessages.map(m => {
            let mRole = 'assistant';
            if (m.is_injection) {
                if (m.role === 1) mRole = 'user';
                else if (m.role === 2) mRole = 'assistant';
                else mRole = 'system';
            } else {
                if (m.extra?.polyceph_hidden) mRole = 'assistant';
                else if (m.is_user) mRole = 'user';
                else if (m.is_system) mRole = 'system';
            }

            let encodedInvocations = '';
            if (m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                encodedInvocations = `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
            }

            if (isCC) {
                return `[[ROLE:${mRole}]]\n${m.mes}${encodedInvocations}\n[[/ROLE]]`;
            }

            // For text completion, we still use a readable format
            if (mRole === 'system') return `### System Instruction:\n${m.mes}${encodedInvocations}`;
            return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}${encodedInvocations}`;
        });

        // 6. Apply Final Limit
        if (options.last !== undefined) {
            const lastN = parseInt(options.last);
            if (!isNaN(lastN)) {
                history = history.slice(-lastN);
            }
        }

        logger.debug(`Resolved {{chat_history}} with ${history.length} messages (Params: ${params || 'none'})`);
        return history.join('\n\n');
    });
}
