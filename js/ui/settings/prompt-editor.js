import { ensureCodeMirror } from './codemirror-loader.js';
import { logger } from '../../logger.js';
import { ROLES, SPECIAL_MACROS, INTERNAL_TAGS } from '../../engine/syntax-definitions.js';

console.log('[Polyceph] prompt-editor.js module script execution start');

/**
 * Creates a CodeMirror instance for a prompt textarea.
 * @param {HTMLTextAreaElement} textarea 
 * @param {Function} onUpdate 
 */
export async function createPromptEditor(textarea, onUpdate, taskLabels = []) {
    if (!textarea) return null;
    console.log(`[Polyceph] createPromptEditor called for: ${textarea.id} with ${taskLabels.length} labels`);

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
        
        // FORCED SYNC: Ensure content is pulled even if initialized while hidden
        if (textarea.value && !cm.getValue()) {
            cm.setValue(textarea.value);
        }
        
        console.log('[Polyceph] CodeMirror instance created');
    } catch (e) {
        console.error('[Polyceph] Failed to create CodeMirror instance:', e);
        return null;
    }

    textarea._cm = cm;
    cm.getWrapperElement().classList.add('polyceph-editor');

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
            // Background classes to carry through
            let bgClass = "";
            if (state.manualRole) {
                bgClass += ` poly-content-${state.manualRole}`;
                if (!state.isPermissive) {
                    bgClass += " poly-content-forced";
                }
            }
            if (state.engineRole) {
                bgClass += ` poly-content-engine-${state.engineRole}`;
            }

            // 1. Role Tags
            if (stream.match(/\\\[\[/)) {
                stream.match(/[^\]]+\]\]/); 
                return "poly-escaped" + bgClass;
            }

            if (stream.match('[[', false)) {
                // Forced Role Tags (e.g. [[system]])
                const forcedRoleMatch = stream.match(new RegExp(`\\[\\[(${rolePattern})(?::([^\\]?]+))?(\\?)?\\]\\]`, 'i'));
                if (forcedRoleMatch) {
                    state.manualRole = forcedRoleMatch[1].toLowerCase();
                    state.isPermissive = !!forcedRoleMatch[3];
                    state.engineRole = null; 
                    return `poly-tag-${state.manualRole}${bgClass}`;
                }

                // Internal Engine Tags (e.g. [[ROLE:user]])
                const internalRoleMatch = stream.match(new RegExp(`\\[\\[ROLE:(${rolePattern})(?::([^\\]?]+))?(\\?)?\\]\\]`, 'i'));
                if (internalRoleMatch) {
                    const tagRole = internalRoleMatch[1].toLowerCase();
                    if (state.isPermissive || !state.manualRole) {
                        state.engineRole = tagRole;
                        return `poly-tag-internal poly-tag-engine-${state.engineRole}${bgClass}`;
                    }
                    return `poly-tag-internal poly-tag-engine-${tagRole}${bgClass}`;
                }
                
                // Closing Tags
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

            // 2. Thinking Blocks (Gold / Italic)
            if (stream.match('<thinking>', true)) return "poly-thinking" + bgClass;
            if (stream.match('</thinking>', true)) return "poly-thinking" + bgClass;

            // 3. Special Macro Tokens ({{world_info}} etc)
            if (stream.match(/\{\{(?:world_info|chat_history|user_input|last_message|description|persona|scenario|post_history|input|thought|extracted_thought|output_token_budget)\}\}/, true)) {
                return "poly-macro-special" + bgClass;
            }

            // 4. Standard Macros ({{task_label}} or other generic ST macros)
            const macroMatch = stream.match(/\{\{/, false);
            if (macroMatch) {
                const labelPattern = taskLabels.length > 0 ? taskLabels.join('|') : '____NEVER_MATCH____';
                const taskMacro = stream.match(new RegExp(`\\{\\{(?:${labelPattern})\\}\\}`, 'i'));
                
                // Task Macros get the special vibrant color
                if (taskMacro) return "poly-macro-special" + bgClass;

                // Standard ST macros get the secondary macro color
                stream.match(/\{\{.*?\}\}/);
                return "poly-macro" + bgClass;
            }

            // 5. Angle Tags (Generic XML-like tags like <info>)
            if (stream.match(/<[^>]+>/, true)) return "poly-angle-tag" + bgClass;

            // 6. Base Markdown Highlighting (Fallthrough)
            const baseToken = baseMode.token(stream, state.baseState);
            return (baseToken ? baseToken + bgClass : (bgClass ? bgClass.trim() : null));
        }
    };

    console.log('[Polyceph] Defining and applying custom mode');
    try {
        const modeName = `polyceph-${textarea.id}`;
        
        // Define the mode in the global registry
        CodeMirror.defineMode(modeName, (config) => {
            return overlayMode(baseMode, polyOverlay, true);
        });
        
        // Apply it
        cm.setOption("mode", modeName);
        console.log('[Polyceph] Mode applied successfully:', modeName);
    } catch (e) {
        console.error('[Polyceph] Failed to apply custom mode:', e);
        cm.setOption("mode", "markdown");
    }

    // Refresh when visible - critical for editors in drawers/tabs
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            cm.refresh();
            // Once refreshed, we don't need to observe anymore
            observer.disconnect();
        }
    });
    observer.observe(cm.getWrapperElement());

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
