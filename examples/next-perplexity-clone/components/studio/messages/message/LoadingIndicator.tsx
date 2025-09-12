import { AnimatePresence, motion } from "framer-motion";
import { UIMessage } from "ai";
import { useAppChat } from "../../context/AppChatProvider";

// Define types for annotations
export type ThinkingAnnotation = {
    type: "thinking";
    contents: string;
    content: string;
};

export type LoadingAnnotation = {
    type: "loading";
    text: string;
    content: string;
    contents: string;
};

export type StatusAnnotation = ThinkingAnnotation | LoadingAnnotation;

interface LoadingIndicatorProps {
    message: UIMessage<{
        loader?: string;
    }, any, any>;
}

export const LoadingIndicator = ({ message }: LoadingIndicatorProps) => {
    const { status } = useAppChat();
    const loader = message.metadata?.loader;

    return (
        <div className="flex gap-2 items-center sticky top-0 z-10 bg-white py-4">
            <div className="bg-black/80 animate-bounce h-4 w-4 rounded-full p-0 text-xs text-white"></div>
            {(() => {

                return (
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={loader}
                            className="loading-text line-clamp-1"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                        >
                            {loader || "Loading..."}
                        </motion.div>
                    </AnimatePresence>
                );
            })()}
        </div>
    );
}; 