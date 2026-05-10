import { logger } from '../../../logger.js';

/**
 * Service to manage connections to MCP (Model Context Protocol) servers.
 */
class McpService {
    constructor() {
        this.transports = new Map(); // name -> transport
        this.initializedTransports = new Set(); // transport
        this.hubAvailable = false;
    }

    /**
     * Attempts to detect the local MCP Tool Hub extension.
     */
    async checkHub() {
        try {
            const context = SillyTavern.getContext();
            const hubPath = 'third-party/st-tool-mcp';
            
            // 1. Check if the extension is actually active/enabled in ST
            // Third-party extensions are listed in context.extensions
            const isActive = context.extensions?.some(ext => ext.name === hubPath || ext.name === 'st-tool-mcp');
            
            if (!isActive) {
                if (this.transports.has('MCP Tool Hub')) {
                    const transport = this.transports.get('MCP Tool Hub');
                    this.initializedTransports.delete(transport);
                    this.transports.delete('MCP Tool Hub');
                }
                this.hubAvailable = false;
                return false;
            }

            // 2. Double check file existence (standard check)
            const hubFile = `/scripts/extensions/${hubPath}/index.js`;
            const head = await fetch(hubFile, { method: 'HEAD' });
            this.hubAvailable = head.ok;
            return this.hubAvailable;
        } catch (e) {
            this.hubAvailable = false;
            return false;
        }
    }

    /**
     * Connects to the local MCP Tool Hub.
     */
    async connectToHub() {
        if (this.transports.has('MCP Tool Hub')) return this.transports.get('MCP Tool Hub');

        try {
            const hubPath = '/scripts/extensions/third-party/st-tool-mcp/index.js';
            const hub = await import(hubPath);
            if (typeof hub.createLocalTransport === 'function') {
                const transport = await hub.createLocalTransport();
                this.transports.set('MCP Tool Hub', transport);
                logger.info('Connected to MCP Tool Hub.');
                return transport;
            }
        } catch (e) {
            logger.error('Failed to connect to Local MCP Tool Hub:', e);
        }
        return null;
    }

    /**
     * Lists tools from all connected MCP servers.
     * Returns an array of OpenAI-compatible function definitions.
     * @param {string[]} selectedSources - Optional list of source names to include.
     */
    async listTools(selectedSources = null) {
        const allTools = [];
        const sourceTools = new Map(); // sourceName -> tools[]

        for (const [name, transport] of this.transports) {
            if (selectedSources && !selectedSources.includes(name)) continue;

            try {
                // MCP handshake: initialize (only once per transport)
                if (!this.initializedTransports.has(transport)) {
                    logger.debug(`Initializing MCP transport for source: ${name}`);
                    // Using empty params for maximum compatibility with the local Hub
                    await this.sendRequest(transport, 'initialize', {});
                    this.initializedTransports.add(transport);

                    // Send initialized notification
                    try {
                        transport.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
                    } catch (e) {}
                }

                // List tools
                const result = await this.sendRequest(transport, 'tools/list', {});
                if (result && result.tools) {
                    sourceTools.set(name, result.tools);
                }
            } catch (e) {
                logger.error(`Failed to list tools from MCP server "${name}":`, e);
            }
        }

        // --- Smart Naming & Collision Handling ---
        this.currentToolMapping = new Map(); // toolName -> { originalName, sourceName }
        const nameUsageCount = new Map();

        // First pass: count name occurrences
        for (const [sourceName, tools] of sourceTools) {
            for (const tool of tools) {
                nameUsageCount.set(tool.name, (nameUsageCount.get(tool.name) || 0) + 1);
            }
        }

        // Second pass: assign names
        for (const [sourceName, tools] of sourceTools) {
            for (const tool of tools) {
                let finalName = tool.name;
                const isCollision = nameUsageCount.get(tool.name) > 1;

                if (isCollision) {
                    // Prefix with source name to resolve collision
                    finalName = `mcp__${sourceName.replace(/\s+/g, '_')}__${tool.name}`;
                }

                this.currentToolMapping.set(finalName, {
                    originalName: tool.name,
                    sourceName: sourceName
                });

                // MCP uses 'inputSchema', but OpenAI/LLMs expect 'parameters'
                // Also wrap in the standard 'type: function' structure
                allTools.push({
                    type: 'function',
                    function: {
                        name: finalName,
                        description: tool.description || '',
                        parameters: tool.inputSchema || { type: 'object', properties: {} }
                    },
                    _mcpOrigin: sourceName // Metadata for Polyceph
                });
            }
        }

        return allTools;
    }

    /**
     * Calls a tool on an MCP server using the mapping established in listTools.
     */
    async callTool(name, args) {
        const mapping = this.currentToolMapping?.get(name);
        if (!mapping) {
            throw new Error(`MCP tool "${name}" not found in current session mapping.`);
        }

        const transport = this.transports.get(mapping.sourceName);
        if (!transport) {
            throw new Error(`Transport for MCP source "${mapping.sourceName}" is no longer active.`);
        }

        try {
            const result = await this.sendRequest(transport, 'tools/call', {
                name: mapping.originalName,
                arguments: typeof args === 'string' ? JSON.parse(args) : args
            });
            return result.content || result;
        } catch (e) {
            logger.error(`MCP tool call failed (${name} via ${mapping.sourceName}):`, e);
            throw e;
        }
    }

    /**
     * Internal helper to send JSON-RPC requests over an MCP transport.
     */
    sendRequest(transport, method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = Math.floor(Math.random() * 1000000);
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`MCP Request ${id} (${method}) timed out`));
            }, 10000);

            const originalOnMessage = transport.onmessage;

            const cleanup = () => {
                clearTimeout(timeout);
                transport.onmessage = originalOnMessage;
            };

            transport.onmessage = (message) => {
                // MCP Hub transport sends the message object directly
                const msg = message.data || message;
                
                if (msg.id === id) {
                    cleanup();
                    if (msg.error) reject(msg.error);
                    else resolve(msg.result);
                } else if (typeof originalOnMessage === 'function') {
                    // Pass through unrelated messages
                    originalOnMessage(message);
                }
            };

            transport.send({
                jsonrpc: '2.0',
                id,
                method,
                params
            });
        });
    }
}

export const mcpService = new McpService();
