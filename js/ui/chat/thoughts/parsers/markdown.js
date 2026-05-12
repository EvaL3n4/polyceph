/**
 * Simple markdown parser for Polyceph UI components.
 * Supports basic formatting often found in tool outputs and reasoning blocks.
 */

/**
 * Parses basic markdown patterns into HTML.
 * @param {string} text - The raw text to parse.
 * @returns {string} The parsed HTML.
 */
export function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;

    let html = text;

    // 1. Headers (H1-H6)
    // We handle them in reverse order to ensure longer patterns match first
    html = html.replace(/^###### (.*$)/gm, '<div class="polyceph-md-h6">$1</div>');
    html = html.replace(/^##### (.*$)/gm, '<div class="polyceph-md-h5">$1</div>');
    html = html.replace(/^#### (.*$)/gm, '<div class="polyceph-md-h4">$1</div>');
    html = html.replace(/^### (.*$)/gm, '<div class="polyceph-md-h3">$1</div>');
    html = html.replace(/^## (.*$)/gm, '<div class="polyceph-md-h2">$1</div>');
    html = html.replace(/^# (.*$)/gm, '<div class="polyceph-md-h1">$1</div>');
    
    // 2. Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 3. Italics (*text* or _text_)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // 4. Strikethrough (~~text~~)
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // 5. Underline (<u>text</u>)
    html = html.replace(/<u>(.*?)<\/u>/g, '<u>$1</u>');
    
    // 6. Inline code (`text`)
    html = html.replace(/`(.*?)`/g, '<code class="polyceph-md-code">$1</code>');
    
    // 5. Bullet points (- text or * text)
    html = html.replace(/^[*-] (.*$)/gm, '<div class="polyceph-md-bullet"><span>•</span> $1</div>');

    return html;
}
