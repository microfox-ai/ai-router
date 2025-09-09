import { UIMessage } from "ai";
import dayjs from "dayjs";
import { useMemo } from "react";
import { MessageWrapper } from "./message/MessageWrapper";
import { useChatUI } from "../context/ChatUiProvider";
import { useAppChat } from "../context/AppChatProvider";
import { getUiParts } from "../context/helpers/parts";
import { MessageProvider } from "../context/MessageProvider";
import { Skeleton } from "@/components/ui/skeleton";

interface TabMessagesProps {
    isLoading: boolean;
}

export default function MessageList({
    isLoading,
}: TabMessagesProps) {

    const { messages, status } = useAppChat();
    const isStreaming = status === "streaming";
    const { messagesEndRef } = useChatUI();

    const renderDateSeparator = (currentDate: string, prevDate?: string) => {
        if (!prevDate || !dayjs(currentDate).isSame(prevDate, "day")) {
            return (
                <div className="my-2 text-center text-xs font-semibold text-gray-500">
                    {dayjs(currentDate).format("DD MMM YYYY")}
                </div>
            );
        }
        return null;
    };

    // const lastAnnotationIndices = useMemo(() => {
    //     const map = new Map<string, number>();
    //     messages.forEach((message, index) => {
    //         const uiParts = getUiParts(message);
    //         (uiParts as any[]).forEach(part => {
    //             if (part.output?.uiComponent) {
    //                 map.set(part.output.uiComponent, index);
    //             }
    //         });
    //     });
    //     return map;
    // }, [messages]);

    return (
        <>
            {isLoading ? (
                <Skeleton className="w-full h-20" />
            ) : messages?.length > 0 ? (
                messages.map((update, index) => {
                    return (
                        <div
                            key={update.id + index}
                            className={`${index === messages.length - 1 ? "min-h-[calc(85vh-258px)]" : ""}`}
                        >
                            <MessageProvider message={update}>
                                <MessageWrapper
                                    message={update}
                                    index={index}
                                    length={messages.length}
                                    renderDateSeperator={(currDate) =>
                                        renderDateSeparator(
                                            currDate,
                                            index > 0
                                                ?
                                                messages?.[index - 1]?.metadata?.createdAt
                                                : ""
                                        )
                                    }
                                />
                            </MessageProvider>
                        </div>
                    );
                })
            ) : (
                <div className="text-center text-gray-500">
                    No messages yet. Start the conversation!
                </div>
            )}
            <div ref={messagesEndRef} />
        </>
    );
}
