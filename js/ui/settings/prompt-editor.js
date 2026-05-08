/**
 * Polyceph Prompt Editor - CodeMirror Integration
 */

import { ensureCodeMirror } from './codemirror-loader.js';
import { logger } from '../../logger.js';
import { ROLES, SPECIAL_MACROS, INTERNAL_TAGS } from '../../engine/syntax-definitions.js';

// Global registry to share editor metadata with popups
window.polycephEditorRegistry = window.polycephEditorRegistry || new Map();

/**
 * Official CodeMirror overlayMode helper (bundled to ensure availability)
 */
const overlayMode = function(base, overlay, combine) {
    return {
        startState: function() {
            return {
                base: CodeMirror.startState(base),
                overlay: overlay.startState(),
                basePos: 0, overlayPos: 0,
                baseCur: null, overlayCur: null
            };
        },
        copyState: function(state) {
            return {
                base: CodeMirror.copyState(base, state.base),
                overlay: overlay.copyState(state.overlay),
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
            stream.pos = Math.min(state.basePos, state.overlayPos);
            if (stream.eol()) state.basePos = state.overlayPos = 0;

            if (state.overlayCur == null) return state.baseCur;
            if (state.baseCur == null || combine) return state.overlayCur + (state.baseCur ? " " + state.baseCur : "");
            else return state.overlayCur;
        },
        indent: base.indent && function(state, textAfter) {
            return base.indent(state.base, textAfter);
        },
        blankLine: function(state) {
            if (base.blankLine) base.blankLine(state.base);
            if (overlay.blankLine) overlay.blankLine(state.overlay);
        },
        innerMode: function(state) { return {state: state.base, mode: base}; }
    };
};

/**
 * Creates a CodeMirror editor for a prompt textarea
 * @param {HTMLTextAreaElement} textarea The textarea to replace
 * @param {Function} onUpdate Callback for value changes
 * @param {string[]} taskLabels List of custom task labels to highlight
 * @param {string[]} extraClasses Optional extra classes for the CM wrapper
 */
export async function createPromptEditor(textarea, onUpdate, taskLabels = [], extraClasses = []) {
    if (!textarea) return null;
    
    try {
        await ensureCodeMirror();
    } catch (e) {
        logger.error('[Polyceph] Failed to load CodeMirror:', e);
        return null;
    }

    // Prevent double initialization
    if (textarea._cm) {
        textarea._cm.toTextArea();
    }

    // Register labels globally for maximized editor lookup
    if (textarea.id) {
        window.polycephEditorRegistry.set(textarea.id, taskLabels);
    }

    const cm = CodeMirror.fromTextArea(textarea, {
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

    textarea._cm = cm;
    const wrapper = cm.getWrapperElement();
    wrapper.classList.add('polyceph-editor');
    extraClasses.forEach(cls => wrapper.classList.add(cls));

    const rolePattern = ROLES.join('|');
    const labels = Array.isArray(taskLabels) ? taskLabels : [];
    const baseMode = CodeMirror.getMode(cm.options, "markdown");

    const polyOverlay = {
        startState: () => ({ 
            manualRole: null, 
            engineRole: null, 
            isPermissive: false,
            baseState: CodeMirror.startState(baseMode)
        }),
        copyState: (state) => ({ 
            manualRole: state.manualRole, 
            engineRole: state.engineRole, 
            isPermissive: state.isPermissive,
            baseState: CodeMirror.copyState(baseMode, state.baseState)
        }),
        token: function (stream, state) {
            let bgClass = "";
            if (state.manualRole) {
                bgClass += ` poly-content-${state.manualRole}`;
                if (!state.isPermissive) bgClass += " poly-content-forced";
            }
            if (state.engineRole) bgClass += ` poly-content-engine-${state.engineRole}`;

            // 1. Role Tags
            if (stream.match(/\\\[\[/)) {
                stream.match(/[^\]]+\]\]/); 
                return "poly-escaped" + bgClass;
            }

            if (stream.match('[[', false)) {
                const forcedRoleMatch = stream.match(new RegExp(`\\[\\[(${rolePattern})(?::([^\\]?]+))?(\\?)?\\]\\]`, 'i'));
                if (forcedRoleMatch) {
                    state.manualRole = forcedRoleMatch[1].toLowerCase();
                    state.isPermissive = !!forcedRoleMatch[3];
                    state.engineRole = null; 
                    return `poly-tag-${state.manualRole}${bgClass}`;
                }

                const internalRoleMatch = stream.match(new RegExp(`\\[\\[ROLE:(${rolePattern})(?::([^\\]?]+))?(\\?)?\\]\\]`, 'i'));
                if (internalRoleMatch) {
                    const tagRole = internalRoleMatch[1].toLowerCase();
                    if (state.isPermissive || !state.manualRole) {
                        state.engineRole = tagRole;
                        return `poly-tag-internal poly-tag-engine-${state.engineRole}${bgClass}`;
                    }
                    return `poly-tag-internal poly-tag-engine-${tagRole}${bgClass}`;
                }
                
                const forcedClose = stream.match(/\[\[\/\]\]/);
                if (forcedClose) {
                    const className = state.manualRole ? `poly-tag-${state.manualRole}-close` : "poly-tag-close";
                    state.manualRole = null;
                    state.engineRole = null;
                    state.isPermissive = false;
                    return className;
                }

                const internalClose = stream.match(new RegExp(`\\[\\[\\/(?:${rolePattern}|ROLE)\\]\\]`, 'i'));
                if (internalClose) {
                    const engineRoleClass = state.engineRole ? `poly-tag-engine-${state.engineRole}` : "poly-tag-engine-close";
                    const className = `poly-tag-internal poly-tag-internal-close ${engineRoleClass}`;
                    state.engineRole = null;
                    return className + bgClass;
                }
            }

            // 2. Thinking Blocks
            if (stream.match(/<\/?thinking>/, true)) return "poly-thinking" + bgClass;

            // 3. Special Macro Tokens
            const specialMacrosPattern = SPECIAL_MACROS.join('|');
            if (stream.match(new RegExp(`\\{\\{(?:${specialMacrosPattern})\\}\\}`), true)) {
                return "poly-macro-special" + bgClass;
            }

            // 4. Standard Macros
            const macroMatch = stream.match(/\{\{/, false);
            if (macroMatch) {
                const labelPattern = labels.length > 0 ? labels.join('|') : '____NEVER_MATCH____';
                const taskMacro = stream.match(new RegExp(`\\{\\{(?:${labelPattern})\\}\\}`, 'i'));
                if (taskMacro) return "poly-macro-special" + bgClass;

                stream.match(/\{\{.*?\}\}/);
                return "poly-macro" + bgClass;
            }

            // 5. Angle Tags
            const internalTagsPattern = INTERNAL_TAGS.join('|');
            if (stream.match(new RegExp(`<\\/?(?:${internalTagsPattern})>`, 'i'))) {
                return "poly-angle-tag" + bgClass;
            }

            // If no match, advance by 1 character to avoid "failed to advance stream"
            stream.next();
            return bgClass ? bgClass.trim() : null;
        }
    };

    const modeName = `polyceph-${textarea.id || Math.random().toString(36).substring(2, 9)}`;
    CodeMirror.defineMode(modeName, () => overlayMode(baseMode, polyOverlay, true));
    cm.setOption("mode", modeName);

    // Handle Maximize button synchronization
    const container = textarea.closest('.polyceph-textarea-container');
    const maximizeBtn = container?.querySelector('.editor_maximize');
    if (maximizeBtn) {
        maximizeBtn.style.zIndex = "10";
        maximizeBtn.addEventListener('mousedown', () => {
            textarea.value = cm.getValue();
        }, true);
        
        textarea.addEventListener('focus', () => {
            if (textarea.value !== cm.getValue()) {
                cm.setValue(textarea.value);
            }
        });
    }

    // Refresh when visible - critical for editors in drawers/tabs
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            cm.refresh();
            observer.disconnect();
        }
    });
    observer.observe(wrapper);

    // Sync CM -> Textarea
    let isSyncing = false;
    cm.on('change', () => {
        if (isSyncing || cm.getOption('readOnly')) return;
        isSyncing = true;
        textarea.value = cm.getValue();
        if (typeof onUpdate === 'function') onUpdate(textarea.value);
        isSyncing = false;
    });

    const refresh = () => cm.refresh();
    setTimeout(refresh, 50);
    setTimeout(refresh, 250);
    setTimeout(refresh, 1000);

    return cm;
}

/**
 * Watches for SillyTavern's maximized editor popup
 */
function initMaximizedEditorObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                const maximizedTextarea = node.querySelector?.('.maximized_textarea[data-for^="polyceph-"]');
                if (maximizedTextarea && !maximizedTextarea.dataset.polycephInitialized) {
                    maximizedTextarea.dataset.polycephInitialized = 'true';
                    const originalId = maximizedTextarea.getAttribute('data-for');
                    const taskLabels = window.polycephEditorRegistry.get(originalId) || [];
                    
                    createPromptEditor(maximizedTextarea, (val) => {
                        const originalTextarea = document.getElementById(originalId);
                        if (originalTextarea) {
                            originalTextarea.value = val;
                            originalTextarea.dispatchEvent(new Event('change', { bubbles: true }));
                            const originalCM = originalTextarea._cm;
                            if (originalCM && originalCM.getValue() !== val) originalCM.setValue(val);
                        }
                    }, taskLabels, ['polyceph-maximized-editor']);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

initMaximizedEditorObserver();
