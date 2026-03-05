import React, { createContext, useContext, useEffect, useState } from "react";
import { UIMessage, UITools } from "ai";
import { getDisplayParts, getStickyUiParts, getToolParts, getUiParts } from "./helpers/parts";
import { useAppChat } from "./AppChatProvider";
import { useComponents } from "./ComponentProvider";



type MessageContextType<TOOLS extends UITools = UITools> = ReturnType<typeof useMessageContext<TOOLS>>;

const MessageContext = createContext<MessageContextType | undefined>(undefined);

export interface MessageProviderProps {
    children: React.ReactNode;
    message: UIMessage;
}

export const useMessageContext = <TOOLS extends UITools = UITools>({ message }: { message: UIMessage<any, any, TOOLS> }) => {
    const [activePart, setActivePart] = useState<number>(0);
    const { aiRouterMetadata } = useComponents();
    const displayParts = getDisplayParts(message, aiRouterMetadata);
    const uiParts = getUiParts(message);
    const toolParts = getToolParts(message);
    const stickyUiParts = getStickyUiParts(uiParts);

    const { status } = useAppChat();

    useEffect(() => {
        if (displayParts && displayParts.length > 1) {
            setActivePart(displayParts.length - 1);
        }
    }, []);

    useEffect(() => {
        if (displayParts && displayParts.length > 1 && status === "streaming" && activePart !== displayParts.length - 1) {
            setActivePart((_index) => displayParts.length - 1);
        }
    }, [displayParts, status, activePart]);

    const setActivePartByToolCallId = (toolCallId?: string) => {
        if (!toolCallId) {
            return;
        }
        const part = displayParts.findIndex((p) => (p as any).toolCallId === toolCallId);
        if (part !== -1) {
            setActivePart(part);
        }
    }

    return {
        activePart,
        setActivePart,
        displayParts,
        uiParts,
        toolParts,
        stickyUiParts,
        message,
        setActivePartByToolCallId,
    };
};

export const MessageProvider: React.FC<MessageProviderProps> = ({
    children,
    message,
}) => {
    const value = useMessageContext({ message });
    return (
        <MessageContext.Provider value={value}>{children}</MessageContext.Provider>
    );
};

export const useMessageParts = <TOOLS extends UITools = UITools>() => {
    const context = useContext(MessageContext) as MessageContextType<TOOLS>;
    if (context === undefined) {
        throw new Error("useMessage must be used within a MessageProvider");
    }
    return context;
};
