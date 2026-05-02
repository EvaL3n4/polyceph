import { logger } from './utils.js';
import { countTokens, getMaxPromptTokens } from '../compat-shared.js';

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
 * Handles: {{chat_history}}, {{chat_history|last:N}}, etc.
 */
export async function resolveChatHistory(text, cleanChat, stContext) {
    if (!text) return text;

    const isCC = stContext.mainApi === 'openai';

    // We use a regex replace with an async function
    const matches = [...text.matchAll(/\{\{chat_history(?:\|([^}]+))?\}\}/g)];
    let newText = text;

    for (const match of matches) {
        const fullMatch = match[0];
        const params = match[1];
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

        // 2. Filter Background Messages
        let filteredMessages = source;
        if (options.bg_last !== undefined) {
            const bgLimit = parseInt(options.bg_last);
            const backgroundMsgs = source.filter(m => m && m.extra?.polyceph_hidden);

            if (backgroundMsgs.length > bgLimit) {
                const keepBgs = backgroundMsgs.slice(-bgLimit);
                filteredMessages = source.filter(m => {
                    if (!m.extra?.polyceph_hidden) return true;
                    return keepBgs.includes(m);
                });
            }
        }

        // 3. Token-Aware Trimming (if last:N is not specified or as a safety layer)
        const budget = getMaxPromptTokens();
        const injectionPrompts = includeInjections ? stContext.extensionPrompts : null;
        
        // Calculate Injection Overhead
        let injectionTokens = 0;
        if (injectionPrompts) {
            const injectionText = Object.values(injectionPrompts).map(p => p.value || '').join('\n');
            injectionTokens = await countTokens(injectionText);
        }

        const usableBudget = budget - injectionTokens - 200; // 200 token safety margin
        
        let trimmedMessages = filteredMessages;
        if (options.last !== undefined) {
            const lastN = parseInt(options.last);
            if (!isNaN(lastN)) {
                trimmedMessages = filteredMessages.slice(-lastN);
            }
        }

        // Final token-aware trim for the history source itself
        const finalSource = [];
        let currentTokens = 0;
        for (let i = trimmedMessages.length - 1; i >= 0; i--) {
            const m = trimmedMessages[i];
            const t = await countTokens(m.mes || '');
            if (currentTokens + t + 20 > usableBudget) break; // 20 token per-msg overhead est
            finalSource.unshift(m);
            currentTokens += t + 20;
        }

        // 4. Map and Weave
        const finalMessages = weaveInjections(finalSource, injectionPrompts);

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

            if (mRole === 'system') return `### System Instruction:\n${m.mes}${encodedInvocations}`;
            return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}${encodedInvocations}`;
        });

        const resolvedHistory = history.join('\n\n');
        newText = newText.replace(fullMatch, resolvedHistory);
        logger.debug(`Resolved {{chat_history}} with ${finalSource.length} messages. Budget: ${usableBudget}, Injections: ${injectionTokens}`);
    }

    return newText;
}
