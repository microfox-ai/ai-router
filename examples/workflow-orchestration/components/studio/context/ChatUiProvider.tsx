import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
} from "react";

// Create the context with a default value
const ChatUIContext = createContext<ReturnType<typeof useChatUIContextValue> | undefined>(undefined);

// Props for the provider component
export interface ChatUIProviderProps {
    children: React.ReactNode;
}

// Define the hook that will be used to create the context value
export const useChatUIContextValue = () => {
    const [hasScrolled, setHasScrolled] = useState<boolean>(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Scroll to the bottom of the chat window
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };


    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (!hasScrolled) {
            setHasScrolled(true);
        }
    };

    // Return the context value
    return {
        hasScrolled,
        setHasScrolled,
        handleScroll,
        messagesEndRef,
        scrollToBottom
    };
};

// The provider component
export const ChatUIProvider: React.FC<ChatUIProviderProps> = ({ children }) => {
    const contextValue = useChatUIContextValue();

    return (
        <ChatUIContext.Provider value={contextValue}>
            {children}
        </ChatUIContext.Provider>
    );
};

// Custom hook to use the ChatUI context
export const useChatUI = () => {
    const context = useContext(ChatUIContext);
    if (context === undefined) {
        throw new Error("useChatUIContext must be used within a ChatUIProvider");
    }
    return context;
};
