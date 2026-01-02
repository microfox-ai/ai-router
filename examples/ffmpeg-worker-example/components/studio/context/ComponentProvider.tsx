'use client';

import React, {
    createContext,
    useContext,
    useState,
    ReactNode,
    ComponentType,
} from 'react';
import { ToolSet, ToolUIPart } from 'ai';
import { AgentData, AgentTool, UITools } from '@microfox/ai-router';

type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2) ? true : false;


type ToolComponentMap<T extends UITools = UITools> = {
    input?: ComponentType<{ tool: ToolUIPart<T> }>;
    output?: ComponentType<{ tool: ToolUIPart<T> }>;
    full?: ComponentType<{ tool: ToolUIPart<T> }>;
    header?: ComponentType<{ tool: ToolUIPart<T> }>;
    header_sticky?: ComponentType<{ tool: ToolUIPart<T>, isStickyRender?: boolean }>;
    footer?: ComponentType<{ tool: ToolUIPart<T> }>;
    footer_sticky?: ComponentType<{ tool: ToolUIPart<T>, isStickyRender?: boolean }>;
    side?: ComponentType<{ tool: ToolUIPart<T> }>;
} & {
    [key: string]: ComponentType<{ tool: ToolUIPart<T> }>;
}

type DataComponentMap<T extends unknown = Record<string, any>> = {
    [key: string]: ComponentType<T>;
}

// Define the type for the component map. It maps a string key to a React component.
export type AiComponentMap<P extends string | number | symbol | any = string, T = unknown> = {
    tools?: Record<keyof P, ToolComponentMap<T extends UITools ? T : any>>;
    data?: Partial<Record<keyof P, DataComponentMap<any>>>;
};

// Define the props for the ComponentProvider. It takes a map of components and children.
export interface ComponentProviderProps {
    children: ReactNode;
    componentMap: AiComponentMap;
    aiRouterTools: ToolSet;
    //aiRouterMetadata: Record<string, AgentTool["metadata"]>;
}

export const useComponentProviderValue = ({
    componentMap,
    aiRouterToolMetadata,
}: {
    componentMap: AiComponentMap;
    aiRouterToolMetadata: Record<string, AgentTool["metadata"]>
}) => {
    const [components] = useState<AiComponentMap>(componentMap);
    const [metadata] = useState<Record<string, AgentTool["metadata"]>>(aiRouterToolMetadata);

    /**
     * Retrieves a component from the map by its name.
     * @param {string} name The name of the component to retrieve.
     * @returns {ComponentType<any> | undefined} The component if found, otherwise undefined.
     */
    const getToolComponent = <P extends keyof ToolComponentMap = keyof ToolComponentMap>(id: string, type: P extends keyof ToolComponentMap ? P : keyof ToolComponentMap) => {
        let _id = (id as string)?.replace("tool-", "");
        if (components?.tools && _id in components.tools) {
            return components.tools
                ?.[_id as keyof AiComponentMap["tools"]]?.[type] as ToolComponentMap[P];
        }
        return undefined;
    };

    const getDataComponent = (id: any, type: keyof DataComponentMap) => {
        let _id = (id as string)?.replace("data-", "") as string;
        if (components?.data && _id in components.data) {
            return components.data?.[_id as keyof AiComponentMap["data"]]?.[type];
        }
        return undefined;
    };

    return {
        getToolComponent,
        getDataComponent,
        aiRouterMetadata: metadata,
    };
};

// Create the context with a default undefined value.
const ComponentContext = createContext<
    ReturnType<typeof useComponentProviderValue> | undefined
>(undefined);

/**
 * The provider component that holds the component map and makes it available to its children.
 * @param {ComponentProviderProps} props The props for the component.
 * @returns {ReactNode} The provider component wrapping the children.
 */
export const ComponentProvider: React.FC<ComponentProviderProps> = ({
    children,
    componentMap,
    aiRouterTools
}) => {
    const aiRouterMetadata: Record<string, AgentTool["metadata"]> = Object.entries(aiRouterTools).reduce((acc, [key, value]) => {
        acc[key as string] = {
            ...(value as AgentTool).metadata,
        };
        return acc;
    }, {} as Record<string, AgentTool["metadata"]>);
    const contextValue = useComponentProviderValue({ componentMap, aiRouterToolMetadata: aiRouterMetadata });

    return (
        <ComponentContext.Provider value={contextValue}>
            {children}
        </ComponentContext.Provider>
    );
};

/**
 * Custom hook to access the component context.
 * This makes it easy for child components to get components from the map.
 * @returns {ReturnType<typeof useComponentProviderValue>} The context value.
 * @throws {Error} If used outside of a ComponentProvider.
 */
export const useComponents = () => {
    const context = useContext(ComponentContext);
    if (context === undefined) {
        throw new Error('useComponents must be used within a ComponentProvider');
    }
    return context;
};
