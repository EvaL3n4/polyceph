import { ensureCodeMirror } from './codemirror-loader.js';
import { logger } from '../../logger.js';
import { ROLES, SPECIAL_MACROS, INTERNAL_TAGS } from '../../engine/syntax-definitions.js';

console.log('[Polyceph] prompt-editor.js module script execution start');

/**
 * Creates a CodeMirror instance for a prompt textarea.
 * @param {HTMLTextAreaElement} textarea 
 * @param {Function} onUpdate 
 */
export async function createPromptEditor(textarea, onUpdate) {
    if (!textarea) return null;
    console.log('[Polyceph] createPromptEditor called for:', textarea.id);

    try {
        await ensureCodeMirror();
        console.log('[Polyceph] CodeMirror libraries ensured');
    } catch (e) {
        console.error('[Polyceph] Failed to load CodeMirror:', e);
        return null;
    }

    console.log('[Polyceph] Syntax Definitions:', { ROLES, SPECIAL_MACROS, INTERNAL_TAGS });

    // Prevent double initialization
    if (textarea._cm) {
        textarea._cm.toTextArea();
    }

    let cm;
    try {
        cm = CodeMirror.fromTextArea(textarea, {
            mode: 'markdown',
            lineNumbers: true,
            lineWrapping: true,
            scrollbarStyle: 'native',
            viewportMargin: Infinity,
            theme: 'default',
            readOnly: textarea.disabled,
            placeholder: textarea.placeholder || 'Enter prompt template...',
            extraKeys: {
                "Tab": (cm) => cm.replaceSelection("    ", "end")
            }
        });
        console.log('[Polyceph] CodeMirror instance created');
    } catch (e) {
        console.error('[Polyceph] Failed to create CodeMirror instance:', e);
        return null;
    }

    textarea._cm = cm;

    const rolePattern = ROLES.join('|');
    const specialMacrosPattern = SPECIAL_MACROS.join('|');
    const internalTagsPattern = INTERNAL_TAGS.join('|');

    console.log('[Polyceph] Patterns initialized:', { rolePattern, specialMacrosPattern, internalTagsPattern });

    // Official CodeMirror overlayMode helper (bundled to ensure availability)
    const overlayMode = function(base, overlay, combine) {
        return {
            startState: function() {
                return {
                    base: CodeMirror.startState(base),
                    overlay: CodeMirror.startState(overlay),
                    basePos: 0, overlayPos: 0,
                    baseCur: null, overlayCur: null
                };
            },
            copyState: function(state) {
                return {
                    base: CodeMirror.copyState(base, state.base),
                    overlay: CodeMirror.copyState(overlay, state.overlay),
                    basePos: state.basePos, overlayPos: state.overlayPos,
                    baseCur: null, overlayCur: null
                };
            },
            token: function(stream, state) {
                if (stream.start == state.basePos) {
                    state.baseCur = base.token(stream, state.base);
                    state.basePos = stream.pos;
                }
                if (stream.start == state.overlayPos) {
                    stream.pos = stream.start;
                    state.overlayCur = overlay.token(stream, state.overlay);
                    state.overlayPos = stream.pos;
                }
                const nextPos = Math.min(state.basePos, state.overlayPos);
                stream.pos = nextPos;
                if (stream.eol()) state.basePos = state.overlayPos = 0;

                const baseStyle = state.baseCur;
                const overlayStyle = state.overlayCur;
                
                if (overlayStyle && baseStyle && combine) return baseStyle + " " + overlayStyle;
                return overlayStyle || baseStyle;
            },
            blankLine: function(state) {
                if (base.blankLine) base.blankLine(state.base);
                if (overlay.blankLine) overlay.blankLine(state.overlay);
            },
            innerMode: function(state) { return {state: state.base, mode: base}; }
        };
    };

    const baseMode = CodeMirror.getMode(cm.options, "markdown");
    const polyOverlay = {
        startState: () => ({ currentRole: null }),
        copyState: (state) => ({ ...state }),
        token: function (stream, state) {
            // Background class to carry through
            const bgClass = state.currentRole ? ` poly-content-${state.currentRole}` : "";

            // Role Tags
            if (stream.match(/\\\[\[/)) {
                stream.match(/[^\]]+\]\]/); 
                return "poly-escaped" + bgClass;
            }

            if (stream.match('[[', false)) {
                const roleMatch = stream.match(new RegExp(`\\[\\[(?:ROLE:)?(${rolePattern})(?::([^\\]?]+))?(\\?)?\\]\\]`, 'i'));
                if (roleMatch) {
                    state.currentRole = roleMatch[1].toLowerCase();
                    return `poly-tag-${state.currentRole}${bgClass}`;
                }
                
                const closeMatch = stream.match(new RegExp(`\\[\\[\\/(?:${rolePattern}|ROLE)?\\]\\]`, 'i')) || stream.match(/\[\[\/\]\]/);
                if (closeMatch) {
                    const className = state.currentRole ? `poly-tag-${state.currentRole}-close` : "poly-tag-close";
                    state.currentRole = null;
                    return className;
                }
            }

            // Macros
            if (stream.match('{{', false)) {
                const macroMatch = stream.match(/{{([^}|]+)(\|[^}]*)?}}/);
                if (macroMatch) {
                    const macroName = macroMatch[1].trim().toLowerCase();
                    const cls = SPECIAL_MACROS.includes(macroName) ? "poly-macro-special" : "poly-macro";
                    return cls + bgClass;
                }
            }

            if (stream.match(/<\/?(think|ramble|background)>/i)) return "poly-thinking" + bgClass;
            if (stream.match(/<\/?\w+[^>]*>/)) return "poly-angle-tag" + bgClass;

            // If inside a role block, provide the background class
            const tokenClass = state.currentRole ? `poly-content-${state.currentRole}` : null;
            
            // Advance
            stream.next();
            while (!stream.eol() && !stream.match(/\[\[|{{|<\/?\w+/, false)) {
                stream.next();
            }
            return tokenClass;
        }
    };

    console.log('[Polyceph] Defining and applying custom mode');
    try {
        const modeName = `polyceph-${textarea.id}`;
        
        // Define the mode in the global registry
        CodeMirror.defineMode(modeName, (config) => {
            console.log('[Polyceph] Mode factory invoked for:', modeName);
            return overlayMode(baseMode, polyOverlay, true);
        });
        
        // Apply it
        cm.setOption("mode", modeName);
        cm.refresh();
        console.log('[Polyceph] Mode applied successfully:', modeName);
    } catch (e) {
        console.error('[Polyceph] Failed to apply custom mode:', e);
        cm.setOption("mode", "markdown");
    }

    // Sync CM -> Textarea
    let isSyncing = false;
    cm.on('change', () => {
        if (isSyncing || cm.getOption('readOnly')) return;
        isSyncing = true;
        textarea.value = cm.getValue();
        if (typeof onUpdate === 'function') onUpdate(textarea.value);
        isSyncing = false;
    });

    // Handle Maximize button synchronization
    const container = textarea.closest('.polyceph-textarea-container');
    const maximizeBtn = container?.querySelector('.editor_maximize');
    
    if (maximizeBtn) {
        // Ensure maximize button is on top
        maximizeBtn.style.zIndex = "10";
        
        maximizeBtn.addEventListener('mousedown', () => {
            textarea.value = cm.getValue();
        }, true);

        textarea.addEventListener('focus', () => {
            if (textarea.value !== cm.getValue()) {
                isSyncing = true;
                cm.setValue(textarea.value);
                isSyncing = false;
            }
        });
    }

    // Force multiple refreshes to ensure dimensions are correct after drawer expansion
    const refresh = () => cm.refresh();
    setTimeout(refresh, 50);
    setTimeout(refresh, 250);
    setTimeout(refresh, 1000);

    return cm;
}
