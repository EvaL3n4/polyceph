/**
 * Internal XML parser using DOMParser.
 */
export function parseInternalXml(xmlString) {
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
