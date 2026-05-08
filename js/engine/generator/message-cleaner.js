/**
 * Cleans up the generated message using SillyTavern's filters.
 */
export function cleanMessage(rawText) {
    const context = SillyTavern.getContext();
    if (typeof context.cleanUpMessage === 'function') {
        return context.cleanUpMessage({
            getMessage: String(rawText),
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: true,
            includeUserPromptBias: false,
            trimNames: true,
            trimWrongNames: true,
        });
    }
    return String(rawText);
}
