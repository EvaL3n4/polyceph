import { logger } from '../../logger.js';
import { stopPipeline } from '../../engine.js';
import { scrollToBottom, scrollToBottomIfNear } from '../ui-shared.js';
import { settings } from '../../state.js';

/**
 * Tries to parse internal data formats like JSON, YAML, or XML.
 * Returns { data, format }
 */
function tryParseInternalData(text) {
    if (typeof text !== 'string') return { data: text, format: null };
    const trimmed = text.trim();

    // 1. Try JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return { data: JSON.parse(trimmed), format: 'JSON' };
        } catch (e) {}
    }

    // 2. Try XML
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
            const data = parseInternalXml(trimmed);
            if (data && Object.keys(data).length > 0) return { data, format: 'XML' };
        } catch (e) {}
    }

    // 3. Try YAML (Robust indentation-aware)
    try {
        const data = parseInternalYaml(trimmed);
        if (data && Object.keys(data).length > 0) {
            // Check if it's actually just a string (one key with no value and no nesting)
            const keys = Object.keys(data);
            if (keys.length === 1 && data[keys[0]] === null && !trimmed.includes(': ')) {
                return { data: text, format: null };
            }
            return { data, format: 'YAML' };
        }
    } catch (e) {}

    return { data: text, format: null };
}

/**
 * Robust YAML parser adapted for internal use.
 */
function parseInternalYaml(yamlString) {
    const lines = yamlString.split('\n');
    const result = {};
    const path = [];
    let currentIndent = -1;

    let hasActualKV = false;

    for (let line of lines) {
        const rawLine = line;
        line = line.trimEnd();
        if (line === '' || line.trim().startsWith('#')) continue;

        const indent = rawLine.search(/\S|$/);
        const trimmed = line.trim();
        const isListItem = trimmed.startsWith('- ');
        const kvSep = line.indexOf(': ');

        // Adjust path based on indentation
        if (indent > currentIndent) {
            path.push('');
        } else if (indent < currentIndent) {
            // Find level based on indentation (assuming 2 spaces)
            const level = Math.max(0, Math.floor(indent / 2));
            path.length = level + 1;
        }
        currentIndent = indent;

        if (isListItem) {
            hasActualKV = true;
            const value = trimmed.slice(2).trim();
            const parent = getInternalPath(result, path.slice(0, -1));
            if (!Array.isArray(parent)) {
                setInternalPath(result, path.slice(0, -1), []);
            }
            const arr = getInternalPath(result, path.slice(0, -1));
            arr.push(parseInternalYamlValue(value));
        } else if (trimmed.endsWith(':')) {
            const key = trimmed.slice(0, -1).trim();
            path[path.length - 1] = key;
            setInternalPath(result, path, {});
            hasActualKV = true;
        } else if (kvSep !== -1) {
            const key = line.slice(0, kvSep).trim();
            const value = line.slice(kvSep + 2).trim();
            path[path.length - 1] = key;
            setInternalPath(result, path, parseInternalYamlValue(value));
            hasActualKV = true;
        } else {
            // Just a key or a string?
            const key = trimmed;
            path[path.length - 1] = key;
            setInternalPath(result, path, null);
        }
    }

    return hasActualKV ? result : null;
}

function parseInternalYamlValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~' || value === '') return null;
    if (!isNaN(value) && value !== '') return Number(value);
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
    return value;
}

function setInternalPath(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {};
        current = current[segment];
    }
    current[path[path.length - 1]] = value;
}

function getInternalPath(obj, path) {
    let current = obj;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function parseInternalXml(xmlString) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');
        if (doc.querySelector('parsererror')) return null;
        
        const nodeToObj = (node) => {
            const result = {};
            const children = node.childNodes;
            let hasElements = false;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child.nodeType !== 1) continue;
                hasElements = true;
                const name = child.tagName;
                const value = child.childNodes.length === 1 && child.childNodes[0].nodeType === 3 
                    ? child.childNodes[0].textContent.trim() 
                    : nodeToObj(child);
                
                if (result[name] !== undefined) {
                    if (!Array.isArray(result[name])) result[name] = [result[name]];
                    result[name].push(value);
                } else {
                    result[name] = value;
                }
            }
            return hasElements ? result : node.textContent.trim();
        };
        return nodeToObj(doc.documentElement);
    } catch (e) { return null; }
}


/**
 * Renders a JSON-like object into a clean, nested UI structure.
 */
function renderJsonObject(data, isRoot = false) {
    if (data === null || data === undefined) return '<span class="polyceph-json-null">null</span>';

    if (typeof data !== 'object') {
        const str = String(data);
        if (typeof data === 'boolean') return `<span class="polyceph-json-boolean">${str}</span>`;
        if (typeof data === 'number') return `<span class="polyceph-json-number">${str}</span>`;
        return `<span class="polyceph-json-string">${str}</span>`;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) return '<span class="polyceph-json-empty">(empty)</span>';
        return `
            <div class="polyceph-json-array">
                ${data.map(item => {
                    const parsed = tryParseInternalData(item);
                    return `
                        <div class="polyceph-json-item-box">
                            ${parsed.format ? `<div class="polyceph-json-item-header"><span class="polyceph-json-format-mini">${parsed.format}</span></div>` : ''}
                            <div class="polyceph-json-item-content">${renderJsonObject(parsed.data, false)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }


    const keys = Object.keys(data);
    if (keys.length === 0) return '<span class="polyceph-json-empty">(empty)</span>';

    // Extract status-related fields for a compact header ONLY at the root of a tool section
    const statusKeys = ['status', 'success', 'ok', 'error'];
    const headerFields = isRoot ? keys.filter(k => statusKeys.includes(k.toLowerCase())) : [];
    const bodyFields = keys.filter(k => !headerFields.includes(k));

    let headerHtml = '';
    if (headerFields.length > 0) {
        headerHtml = `
            <div class="polyceph-json-status-bar">
                ${headerFields.map(k => {
                    const val = data[k];
                    const kLower = k.toLowerCase();
                    const isErrorField = kLower === 'error';
                    
                    let type = 'neutral';
                    if (!isErrorField) {
                        const isOk = (val === true || String(val).toLowerCase() === 'ok' || String(val).toLowerCase() === 'success' || String(val).toLowerCase() === 'true');
                        type = isOk ? 'ok' : 'error';
                    } else {
                        const isError = (val === true || (typeof val === 'string' && val.trim() !== '' && val !== 'false' && val !== '[]' && val !== 'none'));
                        type = isError ? 'error' : 'ok';
                    }

                    const icon = type === 'ok' ? 'fa-check-circle' : 'fa-circle-xmark';
                    let displayVal = val;
                    if (Array.isArray(val) && val.length === 0) displayVal = 'none';

                    return `
                        <div class="polyceph-json-status-pill polyceph-status-${type}">
                            <span class="polyceph-status-key">${k.toUpperCase()}</span>
                            <span class="polyceph-status-val"><i class="fa-solid ${icon}"></i> ${displayVal}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    const bodyHtml = bodyFields.map(key => {
        const parsed = tryParseInternalData(data[key]);
        const isSimple = (typeof parsed.data !== 'object' || parsed.data === null || (Array.isArray(parsed.data) && parsed.data.length === 0));
        const rowClass = isSimple ? 'polyceph-json-field-horizontal' : 'polyceph-json-field-vertical';

        return `
            <div class="polyceph-json-field-box ${rowClass}">
                <div class="polyceph-json-key-container">
                    <span class="polyceph-json-key">${key}</span>
                    ${parsed.format ? `<span class="polyceph-json-format-mini">${parsed.format}</span>` : ''}
                </div>
                <div class="polyceph-json-value">${renderJsonObject(parsed.data, false)}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="polyceph-json-object">
            ${headerHtml}
            <div class="polyceph-json-body">${bodyHtml}</div>
        </div>
    `;
}




/**
 * Generates HTML for a single reasoning thought block.
 */
export function generateSingleThoughtHTML(t) {
    let contentHtml = '';
    let formatLabel = '';

    if (t.type === 'tool') {
        const argsParsed = tryParseInternalData(t.content.args);
        const responseParsed = tryParseInternalData(t.content.response);
        
        formatLabel = responseParsed.format || argsParsed.format || 'DATA';

        contentHtml = `
            <div class="polyceph-tool-details">
                <div class="polyceph-tool-section">
                    <div class="polyceph-tool-section-header">Arguments</div>
                    <div class="polyceph-tool-args-container">${renderJsonObject(argsParsed.data, true)}</div>
                </div>
                <div class="polyceph-tool-section">
                    <div class="polyceph-tool-section-header">Response</div>
                    <div class="polyceph-tool-response-container">${renderJsonObject(responseParsed.data, true)}</div>
                </div>
            </div>
        `;
    } else {
        contentHtml = t.content;
        const stContext = SillyTavern.getContext();
        if (typeof stContext.messageFormatting === 'function') {
            contentHtml = stContext.messageFormatting(contentHtml, 'Polyceph', false, false);
        } else {
            contentHtml = contentHtml.replace(/\n/g, '<br>');
        }
    }

    const openClass = t.isSilent ? '' : 'polyceph-item-open';
    const silentClass = (t.isSilent || t.type === 'tool') ? 'polyceph-silent-thought' : '';
    const toolClass = t.type === 'tool' ? 'polyceph-tool-thought' : '';

    return `<div class="polyceph-generated-thought ${openClass} ${silentClass} ${toolClass}">
        <div class="polyceph-generated-thought-name" style="cursor:pointer;" onclick="this.parentElement.classList.toggle('polyceph-item-open');">
            <span class="polyceph-item-toggle-icon">▶</span> ${t.title}
            <div class="polyceph-item-metadata-group">
                ${formatLabel ? `<span class="polyceph-item-format-tag">${formatLabel}</span>` : ''}
                ${t.profile ? `<span class="polyceph-item-metadata">${t.profile}</span>` : ''}
            </div>
        </div>
        <div class="polyceph-generated-thought-content">${contentHtml}</div>
    </div>`;
}




/**
 * Generates the full HTML container for a list of thoughts.
 */
export function generateThoughtsHTML(thoughtsArray, pipelineName) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';

    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const htmlBlocks = thoughtsArray.map(t => generateSingleThoughtHTML(t)).join('\n<div class="polyceph-thought-separator"></div>\n');

    return `<div id="${thoughtsId}" class="polyceph-thoughts">
        <div class="polyceph-thoughts-details">
            <div class="polyceph-thought-summary">
                <div class="polyceph-thought-summary-container" onclick="this.parentElement.parentElement.classList.toggle('polyceph-thoughts-open');">
                    <div class="polyceph-thought-summary-title">
                        <b>Reasoning</b>
                        ${pipelineName ? `<span class="polyceph-header-metadata">${pipelineName}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="polyceph-thought-items">
                ${htmlBlocks}
            </div>
        </div>
    </div>`;
}

/**
 * Renders the Polyceph typing indicator inside a message block.
 */
export function renderPolycephTyping(messageElement, chatMsg) {
    const activeTasks = chatMsg.extra?.polyceph_active_tasks || [];
    const isStopping = chatMsg.extra?.polyceph_stopping === true;

    let stepInfo = 'Processing';
    if (activeTasks.length > 0) {
        const firstTask = activeTasks[0];
        if (firstTask.id === 'waiting') {
            stepInfo = 'Preparing';
        } else {
            stepInfo = `Step ${firstTask.step}/${firstTask.totalSteps}`;
        }
    } else if (chatMsg.mes && chatMsg.mes.includes('Step')) {
        const match = chatMsg.mes.match(/Step (\d+\/\d+)/);
        if (match) stepInfo = `Step ${match[1]}`;
    }

    const $mesBlock = $(messageElement).find('.mes_block');
    messageElement.setAttribute('polyceph_typing', 'true');

    const isSticky = settings.stickyTypingIndicator;
    let $indicator;

    if (isSticky) {
        let $container = $('#polyceph-sticky-container');
        if ($container.length === 0) $container = $('<div id="polyceph-sticky-container"></div>').appendTo('body');
        $indicator = $container.find('.polyceph-typing-indicator');
        // If it was inline, remove it
        $mesBlock.find('.polyceph-typing-indicator').remove();
    } else {
        $indicator = $mesBlock.find('.polyceph-typing-indicator');
        // If it was sticky, remove it
        $('#polyceph-sticky-container .polyceph-typing-indicator').remove();
    }

    if ($indicator.length === 0) {
        $indicator = $(`
            <div class="polyceph-typing-indicator ${isSticky ? 'polyceph-sticky' : ''}">
                <div class="polyceph-typing-header">
                    <div class="polyceph-typing-title">
                        <span class="fa-solid fa-spinner fa-spin"></span>
                        <span class="polyceph-typing-step-label">Polyceph ${stepInfo}</span>
                    </div>
                    <div class="polyceph-stop-button" title="Stop Pipeline">
                        <span class="fa-solid fa-square"></span>
                    </div>
                </div>
                <div class="polyceph-active-tasks-list"></div>
            </div>
        `);
        $indicator.find('.polyceph-stop-button').on('click', (e) => {
            e.stopPropagation();
            stopPipeline();
        });

        if (isSticky) {
            $('#polyceph-sticky-container').append($indicator);
        } else {
            $mesBlock.append($indicator);
            scrollToBottomIfNear();
        }
    }

    if (isStopping) {
        $indicator.find('.polyceph-typing-step-label').text(`Polyceph Stopping...`);
        $indicator.find('.polyceph-active-tasks-list').html('<div class="polyceph-active-task-label">Cleaning up tasks...</div>');
        $indicator.find('.fa-spinner').removeClass('fa-spinner fa-spin').addClass('fa-hourglass-half');
        $indicator.find('.polyceph-stop-button').hide();
    } else {
        $indicator.find('.polyceph-typing-step-label').text(`Polyceph ${stepInfo}`);
        const tasksHtml = activeTasks.map(task => `
            <div class="polyceph-active-task">
                <div class="polyceph-active-task-label">${task.label}</div>
                <div class="polyceph-active-task-profile">${task.profile}</div>
            </div>
        `).join('');
        $indicator.find('.polyceph-active-tasks-list').html(tasksHtml || '<div class="polyceph-active-task-label">Preparing...</div>');
        $indicator.find('.polyceph-stop-button').show();

        if (!isSticky) {
            scrollToBottomIfNear();
        }
    }
}

/**
 * Main loop to render thoughts and backgrounds for all messages in the chat.
 */
export function renderPolycephThoughts() {
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    // 0. Global Typing State Check
    const anyTyping = context.chat.some(m => m && m.extra && m.extra.polyceph_typing);
    if (!anyTyping && settings.stickyTypingIndicator) {
        $('#polyceph-sticky-container .polyceph-typing-indicator').remove();
    }

    $('#chat .mes').each((_, messageElement) => {
        const mesId = messageElement.getAttribute('mesid');
        const chatMsg = context.chat[mesId];
        if (!chatMsg) return;

        // 1. Handle Typing Indicator
        const isTyping = (chatMsg.extra && chatMsg.extra.polyceph_typing);
        if (isTyping) {
            renderPolycephTyping(messageElement, chatMsg);
            return;
        } else {
            // Only remove inline indicators here; sticky is handled globally
            $(messageElement).find('.polyceph-typing-indicator').remove();
            messageElement.removeAttribute('polyceph_typing');
        }

        // 2. Handle Hidden Background Messages
        if ((chatMsg.extra && chatMsg.extra.polyceph_hidden) || chatMsg.name === 'Background') {
            messageElement.setAttribute('polyceph_hidden', 'true');
            if (messageElement.getAttribute('polyceph_separator_rendered') !== 'true' && !messageElement.querySelector('.polyceph-background-separator')) {
                const $separator = $(`
                    <div class="polyceph-background-separator">
                        <div class="polyceph-background-label">Background Message</div>
                        <div class="polyceph-background-delete fa-solid fa-trash-can" title="Delete message"></div>
                    </div>
                `);
                $separator.on('click', (e) => {
                    const isDelete = e.target.classList.contains('polyceph-background-delete');
                    if (isDelete) {
                        e.stopPropagation();
                        if (typeof context.closeMessageEditor === 'function') context.closeMessageEditor();
                        if (typeof context.hideMenu === 'function') context.hideMenu();
                        if (typeof context.deleteMessage === 'function') {
                            context.deleteMessage(mesId, undefined, true);
                        }
                        return;
                    }
                    messageElement.classList.toggle('polyceph-hidden-open');
                });
                $(messageElement).prepend($separator);
                messageElement.setAttribute('polyceph_separator_rendered', 'true');
            }
        }

        if (chatMsg.is_system && chatMsg.mes === '') {
            messageElement.style.display = 'none';
        }

        // 3. Handle Reasoning/Thoughts Blocks
        const lastRenderedSwipe = messageElement.getAttribute('polyceph_thoughts_swipe');
        const currentSwipeId = String(chatMsg.swipe_id ?? 0);
        const existingThoughtsId = messageElement.getAttribute('polyceph_thoughts_id');
        const thoughtsExistInDOM = existingThoughtsId && document.getElementById(existingThoughtsId);

        if (lastRenderedSwipe === currentSwipeId && thoughtsExistInDOM) return;

        let thoughts = null;
        let pipelineName = null;
        const swipeEntry = chatMsg.swipe_info?.[chatMsg.swipe_id];
        if (swipeEntry) {
            thoughts = swipeEntry.extra?.polyceph_thoughts || null;
            pipelineName = swipeEntry.extra?.polyceph_pipeline || null;
        } else if (chatMsg.extra) {
            thoughts = chatMsg.extra.polyceph_thoughts || null;
            pipelineName = chatMsg.extra.polyceph_pipeline || null;
        }

        if (existingThoughtsId) {
            $(`#${existingThoughtsId}`).remove();
            messageElement.removeAttribute('polyceph_thoughts_id');
        }

        messageElement.setAttribute('polyceph_thoughts_swipe', currentSwipeId);

        if (!thoughts || thoughts.length === 0) return;

        const thoughtsHtml = generateThoughtsHTML(thoughts, pipelineName);
        const $thoughtsContainer = $(thoughtsHtml);
        const thoughtsId = $thoughtsContainer.attr('id');

        const $mesTracker = $(messageElement).find('.mes_tracker').first();
        const $mesText = $(messageElement).find('.mes_text').first();

        if ($mesTracker.length > 0) $mesTracker.before($thoughtsContainer);
        else if ($mesText.length > 0) $mesText.before($thoughtsContainer);
        else $(messageElement).append($thoughtsContainer);

        messageElement.setAttribute('polyceph_thoughts_id', thoughtsId);
    });

    // Defer a final scroll to ensure all injected elements are sized
    setTimeout(() => scrollToBottomIfNear(), 50);
}
