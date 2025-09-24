import {
  UIMessage,
  createUIMessageStream,
  UIMessageStreamWriter,
  createUIMessageStreamResponse,
  UIDataTypes,
  generateId,
  Tool,
  tool,
  JSONValue,
  ToolCallOptions,
  convertToModelMessages,
  ToolSet,
  DataUIPart,
  pipeUIMessageStreamToResponse,
  readUIMessageStream,
} from 'ai';
import { StreamWriter } from './helper.js';
import { UITools } from './types.js';
import { z, ZodObject, ZodType } from 'zod';
import path from 'path';
import { Store, MemoryStore } from './store.js';

// Add global logger management
let globalLogger: AiLogger | undefined = undefined;

/**
 * Sets a global logger that will be used by all router instances when no instance-specific logger is set.
 * This is useful for debugging across multiple router instances.
 * @param logger The logger to use globally, or undefined to disable global logging
 */
export function setGlobalLogger(logger?: AiLogger) {
  globalLogger = logger;
}

/**
 * Gets the current global logger.
 * @returns The current global logger or undefined if none is set
 */
export function getGlobalLogger(): AiLogger | undefined {
  return globalLogger;
}

// --- Helper Functions ---
/**
 * Clubs parts based on toolCallId for tool-* types and id for data-* types
 * @param parts Array of parts to club
 * @returns Clubbed parts array
 */
function clubParts(parts: any[]): any[] {
  if (!parts || parts.length === 0) return parts;

  const clubbedParts: any[] = [];
  const toolCallIdGroups = new Map<string, any[]>();
  const dataIdGroups = new Map<string, any[]>();

  // Group parts by toolCallId for tool-* types and by id for data-* types
  for (const part of parts) {
    if (part.type?.startsWith('tool-') && (part as any).toolCallId) {
      const toolCallId = (part as any).toolCallId;
      if (!toolCallIdGroups.has(toolCallId)) {
        toolCallIdGroups.set(toolCallId, []);
      }
      toolCallIdGroups.get(toolCallId)!.push(part);
    } else if (part.type?.startsWith('data-') && part.id) {
      const id = part.id;
      if (!dataIdGroups.has(id)) {
        dataIdGroups.set(id, []);
      }
      dataIdGroups.get(id)!.push(part);
    } else {
      // For parts that don't match the clubbing criteria, add them directly
      clubbedParts.push(part);
    }
  }

  // Add clubbed tool parts
  for (const [toolCallId, toolParts] of toolCallIdGroups) {
    if (toolParts.length === 1) {
      clubbedParts.push(toolParts[0]);
    } else {
      // Merge multiple parts with same toolCallId
      const mergedPart = { ...toolParts[0] };
      // Combine any additional properties from other parts
      for (let i = 1; i < toolParts.length; i++) {
        const currentPart = toolParts[i];
        // Merge properties, giving priority to later parts
        Object.keys(currentPart).forEach((key) => {
          if (key !== 'type' && key !== 'toolCallId') {
            mergedPart[key] = currentPart[key];
          }
        });
      }
      clubbedParts.push(mergedPart);
    }
  }

  // Add clubbed data parts
  for (const [id, dataParts] of dataIdGroups) {
    if (dataParts.length === 1) {
      clubbedParts.push(dataParts[0]);
    } else {
      // Merge multiple parts with same id
      const mergedPart = { ...dataParts[0] };
      // Combine any additional properties from other parts
      for (let i = 1; i < dataParts.length; i++) {
        const currentPart = dataParts[i];
        // Merge properties, giving priority to later parts
        Object.keys(currentPart).forEach((key) => {
          if (key !== 'type' && key !== 'id') {
            mergedPart[key] = currentPart[key];
          }
        });
      }
      clubbedParts.push(mergedPart);
    }
  }

  return clubbedParts;
}

// --- Custom Errors ---
export class AiKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiKitError';
  }
}

export class AgentNotFoundError extends AiKitError {
  constructor(path: string) {
    super(`[AiAgentKit] Agent not found for path: ${path}`);
    this.name = 'AgentNotFoundError';
  }
}

export class MaxCallDepthExceededError extends AiKitError {
  constructor(maxDepth: number) {
    super(`[AiAgentKit] Agent call depth limit (${maxDepth}) exceeded.`);
    this.name = 'MaxCallDepthExceededError';
  }
}

export class AgentDefinitionMissingError extends AiKitError {
  constructor(path: string) {
    super(
      `[AiAgentKit] agentAsTool: No definition found for "${path}". Please define it using '.actAsTool()' or pass a definition as the second argument.`
    );
    this.name = 'AgentDefinitionMissingError';
  }
}

// --- Dynamic Parameter Support ---

/**
 * Converts a path pattern with dynamic parameters (e.g., "/users/:id/posts/:postId")
 * into a RegExp that can match actual paths and extract parameters.
 * @param pattern The path pattern with dynamic parameters
 * @returns A RegExp and parameter names array
 */
function parsePathPattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  // Split the pattern by dynamic parameter segments, but keep the segments in the result
  const parts = pattern.split(/(\/:[^\/]+)/);

  const regexPattern = parts
    .map((part) => {
      if (part.startsWith('/:')) {
        // This is a dynamic segment like "/:id"
        paramNames.push(part.substring(2)); // Extract "id"
        return '/([^/]+)'; // Replace with a capturing group
      }
      // This is a static segment, escape any special regex characters in it
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');

  const regex = new RegExp(`^${regexPattern}$`);

  return { regex, paramNames };
}

/**
 * Extracts dynamic parameters from a path based on a pattern.
 * @param pattern The path pattern with dynamic parameters
 * @param path The actual path to extract parameters from
 * @returns An object with extracted parameters or null if no match
 */
function extractPathParams(
  pattern: string,
  path: string
): Record<string, string> | null {
  const { regex, paramNames } = parsePathPattern(pattern);
  const match = path.match(regex);

  if (!match) {
    return null;
  }

  const params: Record<string, string> = {};
  paramNames.forEach((paramName, index) => {
    const value = match[index + 1]; // +1 because match[0] is the full match
    if (value !== undefined) {
      params[paramName] = value;
    }
  });

  return params;
}

/**
 * Checks if a path pattern contains dynamic parameters.
 * @param pattern The path pattern to check
 * @returns True if the pattern contains dynamic parameters
 */
function hasDynamicParams(pattern: string): boolean {
  return /\/:[^\/]+/.test(pattern);
}

export type AiStreamWriter<
  METADATA = unknown,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> = UIMessageStreamWriter<UIMessage<METADATA, PARTS, TOOLS>> &
  Omit<StreamWriter<METADATA, TOOLS>, 'writer'> & {
    generateId: typeof generateId;
  };

// --- Core Types ---

/**
 * The context object passed to every agent, tool, and middleware. It contains
 * all the necessary information and utilities for a handler to perform its work.
 * @template METADATA - The type for custom metadata in UI messages.
 * @template PARTS - The type for custom parts in UI messages.
 * @template TOOLS - The type for custom tools in UI messages.
 * @template ContextState - The type for the shared state object.
 */
export type AiContext<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> = {
  request: {
    /** The message history for the current request. The user can modify this array to change the message history or manipulate the message history, but beware that in the routing, the messages are passed as a reference and not a copy, making the mutatated value available to all the handlers in the request chain. */
    messages: UIMessage<METADATA, PARTS, TOOLS>[];
    /** Parameters passed from an internal tool or agent call. */
    params: PARAMS;
    [key: string]: any;
  } & METADATA;
  /** A shared, mutable state object that persists for the lifetime of a single request. */
  state: ContextState;
  /** A shared, mutable store object that persists for the lifetime of a single request. */
  store: Store;
  /**
   * Internal execution context for the router. Should not be modified by user code.
   * @internal
   */
  executionContext: {
    handlerPathStack?: string[];
    currentPath?: string;
    callDepth?: number;
    [key: string]: any;
  };
  /**
   * A unique ID for the top-level request, useful for logging and tracing.
   */
  requestId: string;
  /**
   * A structured logger that automatically includes the `requestId` and current handler path.
   */
  logger: AiLogger;
  /**
   * The stream writer to send data back to the end-user's UI.
   * Includes helpers for writing structured data like tool calls and metadata.
   */
  response: AiStreamWriter<Partial<METADATA>, PARTS, TOOLS>;
  /**
   * Provides functions for an agent to dispatch calls to other agents or tools.
   * @internal
   */
  next: NextHandler<METADATA, ContextState, PARAMS, PARTS, TOOLS>;

  _onExecutionStart?: () => void;
  _onExecutionEnd?: () => void;
};

/** Represents the `next` function in a middleware chain, used to pass control to the next handler. */
export type NextFunction = () => Promise<any>;
/** A function that handles a request for a specific agent path. */
export type AiHandler<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> = (
  ctx: AiContext<METADATA, ContextState, PARAMS, PARTS, TOOLS>
) => Promise<any>;

/** A function that acts as middleware, processing a request and optionally passing control to the next handler. */
export type AiMiddleware<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> = (
  ctx: AiContext<METADATA, ContextState, PARAMS, PARTS, TOOLS>,
  next: NextFunction
) => Promise<any>;

// --- Router Implementation ---

/** A simple structured logger interface. */
export type AiLogger = {
  log: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

/** Internal representation of a registered handler in the router's stack. */
type Layer<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> = {
  path: string | RegExp;
  handler: AiMiddleware<METADATA, ContextState, PARAMS, PARTS, TOOLS>;
  isAgent: boolean;
  // Dynamic parameter support
  hasDynamicParams?: boolean;
  paramNames?: string[];
};

export type AgentTool<
  INPUT extends JSONValue | unknown | never = any,
  OUTPUT extends JSONValue | unknown | never = any,
> = Tool<INPUT, OUTPUT> & {
  name: string;
  id: string;
  metadata?: Record<string, any> & {
    absolutePath?: string;
    name?: string;
    description?: string;
    toolKey?: string;
    icon?: string;
    parentTitle?: string;
    title?: string;
    hideUI?: boolean;
  };
};

export type AgentData = {
  metadata?: Record<string, any> & {
    absolutePath?: string;
    name?: string;
    description?: string;
    toolKey?: string;
    icon?: string;
    parentTitle?: string;
    title?: string;
    hideUI?: boolean;
  };
  [key: string]: any;
};

/**
 * A composable router for building structured, multi-agent AI applications.
 * It allows you to define agents and tools, compose them together, and handle
 * requests in a predictable, middleware-style pattern.
 *
 * @template KIT_METADATA - The base metadata type for all UI messages in this router.
 * @template PARTS - The base custom parts type for all UI messages.
 * @template TOOLS - The base custom tools type for all UI messages.
 * @template ContextState - The base type for the shared state object.
 */
export class AiRouter<
  KIT_METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = {},
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
  REGISTERED_TOOLS extends ToolSet = {},
> {
  private stack: Layer<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>[] = [];
  public actAsToolDefinitions: Map<string | RegExp, AgentTool<any, any>> =
    new Map();
  private logger?: AiLogger = undefined;
  private _store: Store = new MemoryStore();

  /** Configuration options for the router instance. */
  public options: {
    /** The maximum number of agent-to-agent calls allowed in a single request to prevent infinite loops. */
    maxCallDepth: number;
  } = {
    maxCallDepth: 10,
  };

  /**
   * Constructs a new AiAgentKit router.
   * @param stack An optional initial stack of layers, used for composing routers.
   * @param options Optional configuration for the router.
   */
  constructor(
    stack?: Layer<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>[],
    options?: { maxCallDepth?: number; logger?: AiLogger }
  ) {
    // Remove logger from constructor - it should be set via setLogger
    if (stack) {
      this.stack = stack;
    }
    if (options?.maxCallDepth) {
      this.options.maxCallDepth = options.maxCallDepth;
    }
  }

  setStore(store: Store) {
    this._store = store;
  }

  /**
   * Sets a logger for this router instance.
   * If no logger is set, the router will fall back to the global logger.
   * @param logger The logger to use for this router instance, or undefined to use global logger
   */
  setLogger(logger?: AiLogger) {
    this.logger = logger;
  }

  /**
   * Gets the effective logger for this router instance.
   * Returns instance logger if set, otherwise falls back to global logger.
   * @returns The effective logger or undefined if no logging should occur
   */
  private _getEffectiveLogger(): AiLogger | undefined {
    return this.logger ?? globalLogger;
  }

  /**
   * Registers a middleware-style agent that runs for a specific path prefix, regex pattern, or wildcard.
   * Agents can modify the context and must call `next()` to pass control to the next handler in the chain.
   * This method is primarily for middleware. For terminal agents, see `.agent()` on an instance.
   *
   * @param path The path prefix, regex pattern, or "*" for wildcard matching.
   * @param agents The agent middleware function(s).
   */
  agent<
    const TAgents extends (
      | AiMiddleware<any, any, any, any, any>
      | AiRouter<any, any, any, any, any, any>
    )[],
  >(
    agentPath:
      | string
      | RegExp
      | AiMiddleware<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
    ...agents: TAgents
  ): AiRouter<
    KIT_METADATA,
    ContextState,
    PARAMS,
    PARTS,
    TOOLS,
    REGISTERED_TOOLS &
      (TAgents[number] extends AiRouter<any, any, any, any, any, infer R>
        ? R
        : {})
  > {
    let prefix: string | RegExp = '/';
    if (typeof agentPath === 'string' || agentPath instanceof RegExp) {
      prefix = agentPath;
    } else {
      agents.unshift(agentPath);
    }

    for (const handler of agents) {
      if (typeof handler !== 'function') {
        // Check if it's an AiRouter instance for mounting
        if (handler instanceof AiRouter && typeof prefix === 'string') {
          // Use the new use method for mounting routers
          this.use(prefix, handler);
        }
        continue;
      }
      this.stack.push({
        path: prefix,
        handler: handler as any,
        isAgent: true, // Mark as an agent
      });
      this.logger?.log(`Agent registered: path=${prefix}`);
    }

    return this as any;
  }

  /**
   * Mounts a middleware function or another AiAgentKit router at a specific path.
   * This is the primary method for composing routers and applying cross-cutting middleware.
   *
   * @param path The path prefix to mount the handler on.
   * @param handler The middleware function or AiAgentKit router instance to mount.
   */
  use<
    THandler extends
      | AiMiddleware<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>
      | AiRouter<any, any, any, any, any, any>,
  >(
    mountPathArg: string | RegExp,
    handler: THandler
  ): AiRouter<
    KIT_METADATA,
    ContextState,
    PARAMS,
    PARTS,
    TOOLS,
    REGISTERED_TOOLS &
      (THandler extends AiRouter<any, any, any, any, any, infer R> ? R : {})
  > {
    if (mountPathArg instanceof RegExp && handler instanceof AiRouter) {
      throw new AiKitError(
        '[AiAgentKit] Mounting a router on a RegExp path is not supported.'
      );
    }

    if (handler instanceof AiRouter) {
      const router = handler;
      const mountPath = mountPathArg.toString().replace(/\/$/, ''); // remove trailing slash
      // Mount routes from the sub-router
      router.stack.forEach((layer) => {
        const layerPath = layer.path.toString();
        // Prevent layer paths starting with '/' from being treated as absolute by join
        const relativeLayerPath = layerPath.startsWith('/')
          ? layerPath.substring(1)
          : layerPath;
        const newPath = path.posix.join(mountPath, relativeLayerPath);
        this.stack.push({ ...layer, path: newPath });
      });
      // Mount tool definitions from the sub-router
      router.actAsToolDefinitions.forEach((value, key) => {
        const keyPath = key.toString();
        const relativeKeyPath = keyPath.startsWith('/')
          ? keyPath.substring(1)
          : keyPath;
        const newKey = path.posix.join(mountPath, relativeKeyPath);
        this.actAsToolDefinitions.set(newKey, value);
      });
    } else {
      // It's a middleware
      this.stack.push({
        path: mountPathArg,
        handler: handler,
        isAgent: false, // Middleware is not a terminal agent
      });
    }
    return this as any;
  }

  /**
   * Pre-defines the schema and description for an agent when it is used as a tool by an LLM.
   * This allows `next.agentAsTool()` to create a valid `Tool` object without needing the definition at call time.
   * @param path The path of the agent being defined.
   * @param options The tool definition, including a Zod schema and description.
   */
  actAsTool<
    const TPath extends string | RegExp,
    const TTool extends AgentTool<
      z.infer<TTool['inputSchema']>,
      z.infer<TTool['outputSchema']>
    >,
  >(
    path: TPath,
    options: TTool
  ): AiRouter<
    KIT_METADATA,
    ContextState,
    PARAMS,
    PARTS,
    TOOLS,
    REGISTERED_TOOLS & {
      [K in TTool['id']]: Tool<
        z.infer<TTool['inputSchema']>,
        z.infer<TTool['outputSchema']>
      > & {
        metadata: TTool['metadata'] & {
          toolKey: TTool['id'];
          name: TTool['name'];
          description: TTool['description'];
        };
      };
    }
  > {
    this.actAsToolDefinitions.set(path, options);
    this.logger?.log(`[actAsTool] Added definition: at path ${path}`);
    this.logger?.log(
      `[actAsTool] Router now has ${this.actAsToolDefinitions.size} definitions`
    );
    return this as any;
  }

  getToolSet(): REGISTERED_TOOLS {
    let allTools = Array.from(this.actAsToolDefinitions.entries()).map(
      ([key, value]) => {
        return {
          ...value,
          metadata: {
            ...value.metadata,
            absolutePath: key,
          },
        } as AgentTool<any, any>;
      }
    ) as AgentTool<any, any>[];
    return allTools.reduce((acc, _tool) => {
      const { inputSchema, outputSchema } = _tool;
      acc[_tool.id] = {
        ...tool<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>(
          _tool
        ),
        metadata: {
          ..._tool.metadata,
          toolKey: _tool.id,
          name: _tool.name,
          description: _tool.description,
        },
      } as AgentTool<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>;
      return acc;
    }, {} as any) as REGISTERED_TOOLS;
  }

  getToolDefinition(path: string) {
    let definition = this.actAsToolDefinitions.get(path);
    if (!definition) {
      this.logger?.error(
        `[getToolDefinition] No definition found for path: ${path}`
      );
      throw new AgentDefinitionMissingError(path);
    }
    return definition;
  }

  /**
   * Outputs all registered paths, and the middlewares and agents registered on each path.
   * @returns A map of paths to their registered handlers.
   */
  registry(): {
    map: Record<string, { middlewares: any[]; agents: any[] }>;
    tools: REGISTERED_TOOLS;
  } {
    const registryMap: Record<string, { middlewares: any[]; agents: any[] }> =
      {};

    for (const layer of this.stack) {
      const pathKey = layer.path.toString();
      if (!registryMap[pathKey]) {
        registryMap[pathKey] = { middlewares: [], agents: [] };
      }

      if (layer.isAgent) {
        const agentInfo: any = {
          handler: layer.handler.name || 'anonymous',
        };
        const actAsToolDef = this.actAsToolDefinitions.get(layer.path);
        if (actAsToolDef) {
          agentInfo.actAsTool = {
            ...actAsToolDef,
          };
        }
        registryMap[pathKey].agents.push(agentInfo);
      } else {
        registryMap[pathKey].middlewares.push({
          handler: layer.handler.name || 'anonymous',
        });
      }
    }

    return {
      map: registryMap,
      tools: this.getToolSet(),
    };
  }

  /**
   * Resolves a path based on the parent path and the requested path.
   * - If path starts with `@/`, it's an absolute path from the root.
   * - Otherwise, it's a relative path.
   * @internal
   */
  private _resolvePath(parentPath: string, newPath: string): string {
    if (newPath.startsWith('@/')) {
      // Absolute path from root, use POSIX normalize for consistency
      return path.posix.normalize(newPath.substring(1));
    }
    // Relative path, use POSIX join to ensure consistent behavior
    const joinedPath = path.posix.join(parentPath, newPath);
    return joinedPath;
  }

  /**
   * Creates a new context for an internal agent or tool call.
   * It inherits from the parent context but gets a new logger and call depth.
   * @internal
   */
  private _createSubContext(
    parentCtx: AiContext<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
    options: {
      type: 'agent' | 'tool';
      path: string;
      messages?: UIMessage<KIT_METADATA, PARTS, TOOLS>[];
      params: PARAMS;
    }
  ) {
    const parentDepth = parentCtx.executionContext.callDepth ?? 0;
    const newCallDepth = parentDepth + (options.type === 'agent' ? 1 : 0);

    const subContext: AiContext<
      KIT_METADATA,
      ContextState,
      PARAMS,
      PARTS,
      TOOLS
    > = {
      ...parentCtx,
      // State is passed by reference to allow sub-agents to modify the parent's state.
      // The execution context is a shallow copy to ensure call-specific data is isolated.
      state: parentCtx.state,
      store: parentCtx.store,
      executionContext: {
        ...parentCtx.executionContext,
        currentPath: options.path,
        callDepth: newCallDepth,
      },
      request: {
        ...parentCtx.request,
        messages:
          options.messages ||
          parentCtx.request.messages ||
          ([] as UIMessage<KIT_METADATA, PARTS, TOOLS>[]),
        params: options.params,
        path: options.path, // The path to execute
      },
      logger: this._createLogger(
        parentCtx.requestId,
        options.path,
        newCallDepth
      ),
      next: undefined as any, // Will be replaced right after
    };

    // The current path for the new context is the path we are about to execute.
    subContext.executionContext.currentPath = options.path;

    subContext.next = new NextHandler<
      KIT_METADATA,
      ContextState,
      PARAMS,
      PARTS,
      TOOLS
    >(
      subContext,
      this,
      (parentCtx as any)._onExecutionStart,
      (parentCtx as any)._onExecutionEnd,
      parentCtx.next
    ) as any;

    return subContext;
  }

  /**
   * Creates a new logger instance with a structured prefix.
   * @internal
   */
  private _createLogger(
    requestId: string,
    path: string | RegExp,
    callDepth: number = 0
  ): AiLogger {
    const effectiveLogger = this._getEffectiveLogger();

    // If no logger is available, return a no-op logger
    if (!effectiveLogger) {
      return {
        log: () => {},
        warn: () => {},
        error: () => {},
      };
    }

    const indent = '  '.repeat(callDepth);
    const prefix = `${indent}[${path.toString()}]`;
    // Add requestId to every log message for better tracking.
    const fullPrefix = `[${requestId}]${prefix}`;
    return {
      log: (...args: any[]) => effectiveLogger.log(fullPrefix, ...args),
      warn: (...args: any[]) => effectiveLogger.warn(fullPrefix, ...args),
      error: (...args: any[]) => effectiveLogger.error(fullPrefix, ...args),
    };
  }

  /**
   * Calculates a specificity score for a layer to enable Express-style routing.
   * Higher score means more specific.
   * - Middleware is less specific than an agent/tool.
   * - Deeper paths are more specific.
   * - Static segments are more specific than dynamic segments.
   * @internal
   */
  private _getSpecificityScore(
    layer: Layer<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>
  ): number {
    const path = layer.path.toString();
    let score = 0;

    // Base score on depth. Deeper is more specific.
    score += path.split('/').length * 100;

    // More dynamic segments mean less specific.
    score -= (path.match(/:/g) || []).length * 10;

    // Regex is less specific than a string path.
    if (layer.path instanceof RegExp) {
      score -= 50;
    }

    // Agents/tools are more specific than middleware.
    if (layer.isAgent) {
      score += 1;
    }

    return score;
  }

  /**
   * The core execution engine. It finds all matching layers for a given path
   * and runs them in a middleware-style chain.
   * @internal
   */
  private async _execute(
    path: string,
    ctx: AiContext<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
    isInternalCall = false
  ) {
    // The context's `currentPath` is now the single source of truth.
    // No more stack manipulation is needed here.
    try {
      const normalizedPath =
        path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

      ctx.logger.log(`Executing path. isInternalCall=${isInternalCall}`);
      const layersToRun = this.stack.filter((layer) => {
        let shouldRun = false;

        // Handle RegExp paths. For internal calls, we demand an exact match.
        if (layer.path instanceof RegExp) {
          if (isInternalCall) {
            const exactRegex = new RegExp(`^${layer.path.source}$`);
            shouldRun = exactRegex.test(normalizedPath);
          } else {
            shouldRun = layer.path.test(normalizedPath);
          }
        } else if (typeof layer.path === 'string') {
          const layerPath = layer.path;

          // Wildcard middleware only runs for external calls.
          if (layerPath === '*') {
            return !isInternalCall;
          }

          const normalizedLayerPath =
            layerPath.length > 1 && layerPath.endsWith('/')
              ? layerPath.slice(0, -1)
              : layerPath;

          const isExactMatch = normalizedPath === normalizedLayerPath;

          if (isInternalCall) {
            // --- Internal Call Logic ---
            // For internal calls, we only consider exact matches for all layer types.
            shouldRun = isExactMatch;
          } else {
            // --- External Call Logic ---
            if (layer.isAgent) {
              // Agents are only matched exactly.
              shouldRun = isExactMatch;
            } else {
              // Middlewares are matched by prefix.
              shouldRun = normalizedPath.startsWith(normalizedLayerPath);
            }
          }
        }

        if (shouldRun) {
          ctx.logger.log(
            `[AiAgentKit][_execute] Layer MATCH: path=${normalizedPath}, layer.path=${layer.path}, isAgent=${layer.isAgent}, isInternal=${isInternalCall}`
          );
        }
        return shouldRun;
      });

      // Sort layers by specificity (most general first) to ensure correct execution order.
      layersToRun.sort(
        (a, b) => this._getSpecificityScore(a) - this._getSpecificityScore(b)
      );

      const layerDescriptions = layersToRun.map(
        (l) => `${l.path.toString()} (${l.isAgent ? 'agent' : 'middleware'})`
      );
      ctx.logger.log(
        `Found ${layersToRun.length} layers to run: [${layerDescriptions.join(
          ', '
        )}]`
      );
      const hasAgent = layersToRun.some((l) => l.isAgent);

      if (!layersToRun.length) {
        const errorMsg = `No agent or tool found for path: ${normalizedPath}`;
        ctx.logger.error(errorMsg);
        throw new AgentNotFoundError(normalizedPath);
      }

      // A more robust, explicit dispatcher to avoid promise chain issues.
      const dispatch = async (index: number): Promise<any> => {
        const layer = layersToRun[index];
        if (!layer) {
          // End of the chain
          return;
        }

        const next = () => dispatch(index + 1);

        const layerPath =
          typeof layer.path === 'string' ? layer.path : layer.path.toString();

        const layerType = layer.isAgent ? 'agent' : 'middleware';
        ctx.logger.log(`-> Running ${layerType}: ${layerPath}`);

        try {
          if (ctx._onExecutionStart) {
            ctx._onExecutionStart();
          }
          // The handler is an async function, so we can await it directly.
          // The original Promise wrapper was redundant and could hide issues.
          const result = await layer.handler(ctx, next);

          // if (!isInternalCall) {
          //   console.log('toolDefinition', result);
          //   const toolDefinition = this.actAsToolDefinitions.get(path);
          //   if (toolDefinition && !toolDefinition.metadata?.hideUI) {
          //     ctx.response.writeCustomTool({
          //       toolName: toolDefinition.id as string,
          //       toolCallId: toolDefinition.id + '-' + ctx.response.generateId(),
          //       output: result,
          //     });
          //   }
          // }
          ctx.logger.log(`<- Finished ${layerType}: ${layerPath}`);
          return result;
        } catch (err) {
          ctx.logger.error(
            `Error in ${layerType} layer for path: ${layerPath}`,
            err
          );
          throw err;
        } finally {
          if (ctx._onExecutionEnd) {
            ctx._onExecutionEnd();
          }
        }
      };

      return await dispatch(0);
    } finally {
      // No-op. Stack is managed by context creation/destruction.
    }
  }

  private pendingExecutions = 0;

  /**
   * The main public entry point for the router. It handles an incoming request,
   * sets up the response stream, creates the root context, and starts the execution chain.
   *
   * @param path The path of the agent or tool to execute.
   * @param initialContext The initial context for the request, typically containing messages.
   * @returns A standard `Response` object containing the rich UI stream.
   */
  handle(
    path: string,
    initialContext: Omit<
      AiContext<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
      | 'state'
      | 'response'
      | 'next'
      | 'requestId'
      | 'logger'
      | 'executionContext'
      | 'store'
    >
  ): Response {
    this.logger?.log(`Handling request for path: ${path}`);
    const self = this; // Reference to the router instance

    // --- Execution Lifecycle Management ---
    let executionCompletionResolver: (() => void) | null = null;
    const executionCompletionPromise = new Promise<void>((resolve) => {
      executionCompletionResolver = resolve;
    });

    // --- End Execution Lifecycle Management ---

    return createUIMessageStreamResponse({
      stream: self.handleStream(
        path,
        initialContext,
        executionCompletionPromise,
        executionCompletionResolver
      ),
    });
  }

  handleStream(
    path: string,
    initialContext: Omit<
      AiContext<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
      | 'state'
      | 'response'
      | 'next'
      | 'requestId'
      | 'logger'
      | 'executionContext'
      | 'store'
    >,
    executionCompletionPromise: Promise<void>,
    executionCompletionResolver: (() => void) | null
  ) {
    const self = this;
    return createUIMessageStream({
      originalMessages: initialContext.request.messages,
      execute: async ({ writer }) => {
        const streamWriter = new StreamWriter<KIT_METADATA, TOOLS>(writer);
        const requestId = generateId();

        // If the configured store is a MemoryStore, create a new one for each request
        // to prevent state leakage between concurrent requests. If it's a different
        // type of store, we assume it's designed to be shared.
        const store =
          self._store instanceof MemoryStore ? new MemoryStore() : self._store;

        const ctx: AiContext<
          KIT_METADATA,
          ContextState,
          PARAMS,
          PARTS,
          TOOLS
        > & {
          _onExecutionStart: () => void;
          _onExecutionEnd: () => void;
        } = {
          ...initialContext,
          request: {
            ...initialContext.request,
            path: path, // Set the initial path for the root context
          },
          state: {} as any,
          store: store,
          executionContext: { currentPath: path, callDepth: 0 },
          requestId: requestId,
          logger: self._createLogger(requestId, path, 0),
          response: {
            ...streamWriter.writer,
            writeMessageMetadata: streamWriter.writeMessageMetadata,
            writeCustomTool: streamWriter.writeCustomTool,
            writeObjectAsTool: streamWriter.writeObjectAsTool,
            generateId: generateId,
          },
          next: undefined as any, // Will be replaced right after
          _onExecutionStart: () => {
            self.pendingExecutions++;
            self.logger?.log(
              `[AiAgentKit][lifecycle] Execution started. Pending: ${self.pendingExecutions}`
            );
          },
          _onExecutionEnd: () => {
            self.pendingExecutions--;
            self.logger?.log(
              `[AiAgentKit][lifecycle] Execution ended. Pending: ${self.pendingExecutions}`
            );
            if (self.pendingExecutions === 0 && executionCompletionResolver) {
              self.logger?.log(
                `[AiAgentKit][lifecycle] All executions finished. Resolving promise.`
              );
              executionCompletionResolver();
            }
          },
        };
        ctx.next = new NextHandler(
          ctx,
          self,
          ctx._onExecutionStart,
          ctx._onExecutionEnd
        ) as any;

        ctx._onExecutionStart();
        self.logger?.log(
          `[AiAgentKit][lifecycle] Main execution chain started.`
        );

        // Fire off the main execution chain. We don't await it here because, in a streaming
        // context, the await might resolve prematurely when the agent yields control.
        // Instead, we catch errors and use .finally() to reliably mark the end of this
        // specific execution, while the main function body waits on the lifecycle promise.
        // self
        //   ._execute(path, ctx)
        //   .catch((err) => {
        //     ctx.logger.error("Unhandled error in main execution chain", err);
        //     // Optionally, you could write an error message to the stream here.
        //   })
        //   .finally(() => {
        //     ctx._onExecutionEnd();
        //   });

        try {
          const response = await self._execute(path, ctx);
          const toolDefinition = this.actAsToolDefinitions.get(path);
          if (toolDefinition && !toolDefinition.metadata?.hideUI) {
            ctx.response.writeCustomTool({
              toolName: toolDefinition.id as string,
              toolCallId: toolDefinition.id + '-' + ctx.response.generateId(),
              output: response,
            });
          }
          return response;
        } catch (err) {
          ctx.logger.error('Unhandled error in main execution chain', err);
        } finally {
          ctx._onExecutionEnd();
          self.logger?.log(
            `[AiAgentKit][lifecycle] Main execution chain finished.`
          );
        }

        // ctx.next
        //   .callAgent(path, initialContext.request.params)
        //   .catch((err) => {
        //     ctx.logger.error("Unhandled error in main execution chain", err);
        //   });

        // Wait for the promise that resolves only when all executions (the main one
        // and all sub-calls) have completed.
        await executionCompletionPromise;
        self.logger?.log(
          `[AiAgentKit][lifecycle] All executions truly finished. Stream can be safely closed.`
        );
      },
    });
  }

  /**
   * Handles an incoming request and returns a promise that resolves with the full,
   * non-streamed response. This is useful for environments where streaming is not
   * desired or for testing.
   *
   * @param path The path of the agent or tool to execute.
   * @param initialContext The initial context for the request, typically containing messages.
   * @returns A `Promise<Response>` that resolves with the final JSON response.
   */
  async toAwaitResponse(
    path: string,
    initialContext: Omit<
      AiContext<KIT_METADATA, ContextState, PARAMS, PARTS, TOOLS>,
      | 'state'
      | 'response'
      | 'next'
      | 'requestId'
      | 'logger'
      | 'executionContext'
      | 'store'
    >
  ): Promise<Response> {
    this.logger?.log(`Handling request for path: ${path}`);
    const self = this; // Reference to the router instance

    // --- Execution Lifecycle Management ---
    let executionCompletionResolver: (() => void) | null = null;
    const executionCompletionPromise = new Promise<void>((resolve) => {
      executionCompletionResolver = resolve;
    });

    const stream = this.handleStream(
      path,
      initialContext,
      executionCompletionPromise,
      executionCompletionResolver
    );

    const messageStream = readUIMessageStream({
      stream,
      onError: (error) => {
        this.logger?.error('Error reading UI message stream', error);
      },
    });

    let finalMessages: UIMessage[] = [];
    const thisMessageId = generateId();
    for await (const message of messageStream) {
      if (message.id?.length > 0) {
        finalMessages.push(message);
      } else if (finalMessages.find((m) => m.id === thisMessageId)) {
        finalMessages = finalMessages.map((m) =>
          m.id === thisMessageId
            ? {
                ...m,
                metadata: {
                  ...(m.metadata ?? {}),
                  ...(message.metadata ?? {}),
                },
                parts: clubParts([
                  ...(m.parts ?? []),
                  ...(message.parts ?? []),
                ]),
              }
            : m
        );
      } else {
        finalMessages.push({
          ...message,
          id: thisMessageId,
        });
      }
    }
    const responseBody = JSON.stringify(finalMessages);
    return new Response(responseBody, {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export type AiRouterType = typeof AiRouter;

class NextHandler<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
  PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> {
  public maxCallDepth: number;

  constructor(
    private ctx: AiContext<METADATA, ContextState, PARAMS, PARTS, TOOLS>,
    private router: AiRouter<METADATA, ContextState, PARAMS, PARTS, TOOLS>,
    private onExecutionStart: () => void,
    private onExecutionEnd: () => void,
    parentNext?: NextHandler<METADATA, ContextState, PARAMS, PARTS, TOOLS>
  ) {
    this.maxCallDepth = this.router.options.maxCallDepth;
  }

  async callAgent(
    agentPath: string,
    params?: Record<string, any>,
    options?: {
      streamToUI?: boolean;
    }
  ): Promise<{ ok: true; data: any } | { ok: false; error: Error }> {
    this.onExecutionStart();
    try {
      const currentDepth = this.ctx.executionContext.callDepth ?? 0;
      if (currentDepth >= this.maxCallDepth) {
        const err = new MaxCallDepthExceededError(this.maxCallDepth);
        this.ctx.logger.error(`[callAgent] Aborting. ${err.message}`);
        throw err;
      }
      const parentPath = this.ctx.executionContext.currentPath || '/';
      const resolvedPath = (this.router as any)._resolvePath(
        parentPath,
        agentPath
      );

      this.ctx.logger.log(`Calling agent: resolvedPath='${resolvedPath}'`);

      const subContext = (this.router as any)._createSubContext(this.ctx, {
        type: 'agent',
        path: resolvedPath,
        params: params ?? ({} as PARAMS),
        messages: this.ctx.request.messages,
      });

      const definition = this.router.actAsToolDefinitions.get(resolvedPath);
      const toolCallId = definition?.id + '-' + this.ctx.response.generateId();
      if (options?.streamToUI && definition) {
        this.ctx.response.writeCustomTool({
          toolName: definition?.id,
          toolCallId: toolCallId,
          input: subContext.request.params,
        });
      }

      const data = await (this.router as any)._execute(
        resolvedPath,
        subContext,
        true
      );

      if (options?.streamToUI && definition) {
        this.ctx.response.writeCustomTool({
          toolName: definition?.id,
          toolCallId: toolCallId,
          output: data,
        });
      }

      return { ok: true, data };
    } catch (error: any) {
      this.ctx.logger.error(`[callAgent] Error:`, error);
      return { ok: false, error };
    } finally {
      this.onExecutionEnd();
    }
  }

  agentAsTool<INPUT extends JSONValue | unknown | never = any, OUTPUT = any>(
    agentPath: string,
    toolDefinition?: AgentTool<INPUT, OUTPUT>
  ) {
    const parentPath = this.ctx.executionContext.currentPath || '/';
    const resolvedPath = (this.router as any)._resolvePath(
      parentPath,
      agentPath
    );
    let preDefined;
    const pathsToTry = [resolvedPath];
    // If the agentPath starts with '/', it's an absolute path from root, so also try it directly
    if (agentPath.startsWith('/')) {
      pathsToTry.unshift(agentPath);
    }
    for (const pathToTry of pathsToTry) {
      for (const [key, value] of (this.router as any).actAsToolDefinitions) {
        if (typeof key === 'string') {
          // Check for exact match first
          if (key === pathToTry) {
            preDefined = value;
            break;
          }
          // Then check for dynamic path parameters
          if (extractPathParams(key, pathToTry) !== null) {
            preDefined = value;
            break;
          }
        }
        // Basic RegExp match
        if (key instanceof RegExp && key.test(pathToTry)) {
          preDefined = value;
          break;
        }
      }
      if (preDefined) break;
    }

    const definition = toolDefinition || preDefined;
    if (!definition) {
      this.ctx.logger.error(
        `[agentAsTool] No definition found for agent at resolved path: ${resolvedPath}`
      );
      throw new AgentDefinitionMissingError(resolvedPath);
    }
    const { id, metadata, ...restDefinition } = definition;
    return {
      [id]: {
        ...restDefinition,
        metadata: {
          ...metadata,
          toolKey: id,
          name: restDefinition.name,
          description: restDefinition.description,
          absolutePath: restDefinition.path,
        },
        execute: async (params: any, options: any) => {
          const result = await this.callAgent(agentPath, params, options);
          if (!result.ok) {
            throw result.error;
          }
          return result.data;
        },
      } as Tool<INPUT, OUTPUT>,
    };
  }

  getToolDefinition(agentPath: string | RegExp) {
    const parentPath = this.ctx.executionContext.currentPath || '/';
    const resolvedPath = (this.router as any)._resolvePath(
      parentPath,
      agentPath
    );
    let preDefined;
    const pathsToTry = [resolvedPath];
    // If the agentPath starts with '/', it's an absolute path from root, so also try it directly
    if (typeof agentPath === 'string' && agentPath.startsWith('/')) {
      pathsToTry.unshift(agentPath);
    }
    for (const pathToTry of pathsToTry) {
      for (const [key, value] of (this.router as any).actAsToolDefinitions) {
        if (typeof key === 'string') {
          // Check for exact match first
          if (key === pathToTry) {
            preDefined = value;
            break;
          }
          // Then check for dynamic path parameters
          if (extractPathParams(key, pathToTry) !== null) {
            preDefined = value;
            break;
          }
        }
        // Basic RegExp match
        if (key instanceof RegExp && key.test(pathToTry)) {
          preDefined = value;
          break;
        }
      }
      if (preDefined) break;
    }

    const definition = preDefined;
    if (!definition) {
      this.ctx.logger.error(
        `[agentAsTool] No definition found for agent at resolved path: ${resolvedPath}`
      );
      throw new AgentDefinitionMissingError(resolvedPath);
    }
    const { metadata, ...restDefinition } = definition;
    return {
      ...restDefinition,
      metadata: {
        ...metadata,
        toolKey: restDefinition.id,
        name: restDefinition.name,
        description: restDefinition.description,
        absolutePath: restDefinition.path,
      },
    } as AgentTool<any, any>;
  }
}
