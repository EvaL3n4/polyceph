import { generateViaCC } from '../../compat-chat.js';

/**
 * Internal helper: runs the non-streaming generation path with timeout/abort racing.
 */
export async function _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs, noEmissions = false, options = {}) {
    const apiPromise = generateViaCC(messages, tools, tool_choice, noEmissions, options);

    const abortPromise = signal ? new Promise((_, reject) => {
        if (signal.aborted) reject(new Error('Aborted'));
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }) : null;

    if (timeoutMs > 0) {
        const raceArr = [
            apiPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
        ];
        if (abortPromise) raceArr.push(abortPromise);
        return await Promise.race(raceArr);
    } else {
        return await (abortPromise ? Promise.race([apiPromise, abortPromise]) : apiPromise);
    }
}
