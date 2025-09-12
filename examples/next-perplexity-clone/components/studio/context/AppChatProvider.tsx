
import { RestSdk } from "@/lib/studio/services/RestSdk";
import { useChat, UseChatOptions } from "@ai-sdk/react";
import { getTextParts } from "@microfox/ai-router";
import {
    ChatRequestOptions,
    DefaultChatTransport,
    UIMessage
} from "ai";
import { useParams } from "next/navigation";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";

type AppContextType = ReturnType<typeof useAppContext>;

const AppContext = createContext<AppContextType | undefined>(
    undefined
);

export interface AppChatProviderProps {
    children: React.ReactNode;
    chatOptions?: Partial<UseChatOptions<UIMessage<any, any, any>>>;
    sessionId?: string;
}

export const useAppContext = (
    userChatOptions?: Partial<UseChatOptions<UIMessage>>,
    thisSessionId?: string
) => {

    const sessionId = thisSessionId || "undefined";

    const {
        data: serverMessages,
        mutate,
        isValidating,
        isLoading,
    } = useSWR<UIMessage[]>(
        sessionId && sessionId != "undefined" ? `/api/studio/chat/message?sessionId=${sessionId}` : undefined,
        async (url: string) => {
            const res = await RestSdk.getData(url, {});
            return res;
        },
        {
            revalidateOnMount: true,
            revalidateOnFocus: true,
        }
    );

    const { ...chatOptions } = useChat<UIMessage<any, any, any>>({
        transport: new DefaultChatTransport({
            api: sessionId && sessionId != "undefined" ? "/api/studio/chat" : undefined,
            prepareSendMessagesRequest: ({
                id,
                messages,
                requestMetadata,
                body,
                ...rest
            }) => {
                console.log("[prepareSendMessagesRequest]", {
                    id,
                    messages,
                    requestMetadata,
                    body,
                    rest,
                });
                return {
                    ...rest,
                    headers: {
                        "Content-Type": "application/json",
                        "x-client-request-id": sessionId ?? "",
                        ...rest.headers,
                    },
                    body: {
                        ...body,
                        messages: [messages[messages.length - 1]],
                        sessionId: sessionId
                    },
                };
            },
        }),
        resume: false,
        messages: (serverMessages as any[]) || [],
        ...userChatOptions,
        id: sessionId,
        onFinish: (response) => {
            console.log("[onFinish] called with response:", response);
            try {
                const { message, ...rest } = response;
                let _minionFlow;
                let _minionType;
                //add this message to the db
                if (
                    message?.parts?.length === 0 ||
                    !message.role ||
                    !message?.parts ||
                    !message?.parts[0]
                ) {
                    console.log("[onFinish] Message has no parts, returning.");
                    return;
                }
                const _sessionId =
                    message.metadata?.sessionId ?? sessionId;
                const postDataPayload = {
                    context: "on-finish",
                    id: message.id?.startsWith(_sessionId)
                        ? message.id
                        : _sessionId + "-" + message.id,
                    role: message.role,
                    metadata: message.metadata,
                    parts: message.parts,
                    content: getTextParts(message).join(", ") ?? "",
                    ...rest,
                    sessionId: _sessionId,
                };
                console.log(
                    "[onFinish] Storing assistant message to DB with payload:",
                    postDataPayload
                );
                RestSdk.postData("/api/studio/chat/message", postDataPayload);
            } catch (error) {
                console.error("[onFinish] Error storing assistant message:", error);
            }
        },
        onError: (error) => {
            console.error("[onError] Chat error:", error);
        },
    });

    useEffect(() => {
        if (
            serverMessages &&
            chatOptions.messages.length === 0 &&
            serverMessages.length > 0
        ) {
            chatOptions.setMessages(serverMessages as any);
        }
    }, [serverMessages, chatOptions.messages, chatOptions.status]);

    //-----------LISTENING-------------
    //console.log("lastKnownStuff", lastKnownMinionType, lastKnownMinionFlow);

    useEffect(() => {
        // console.log("messages", chatOptions.messages);
        // const lastMessage = chatOptions.messages?.[chatOptions.messages.length - 1];
        // const isClientRequestTitle: any = lastMessage?.metadata?.clientRequestTitle;
        // if (isClientRequestTitle && isClientRequestTitle !== selectedRequest?.title) {
        //   mutateSelectedClientRequest();
        // }
    }, [chatOptions.messages]);

    // useEffect(() => {
    //   //console.log("data", chatOptions.data);
    // }, [chatOptions.data]);

    //-----------DB OPERATIONS -----------------
    const createMessage = useCallback(
        async (
            message: UIMessage
        ) => {
            console.log("[createMessage] called with:", {
                message
            });
            if (!message.id) {
                message.id = crypto.randomUUID();
                console.log("[createMessage] Generated new message id:", message.id);
            }
            try {
                const payload = {
                    ...message,
                    id: message.id?.startsWith(sessionId) ? message.id : sessionId + "-" + message.id,
                    sessionId: sessionId,
                    content: getTextParts(message).join(", ") ?? "",
                    context: "on-start",
                };
                console.log(
                    "[createMessage] Posting message to DB with payload:",
                    payload
                );
                await RestSdk.postData("/api/studio/chat/message", payload);
                console.log("[createMessage] Successfully posted message to DB.");
            } catch (error) {
                console.error("[createMessage] Error creating message:", error);
            }
        },
        [sessionId]
    );

    const deleteMessages = useCallback(
        async (messageIds: string[]) => {
            if (!sessionId) {
                return;
            }
            let _ids = messageIds.map((_id) =>
                _id.startsWith(sessionId) ? _id : sessionId + "-" + _id
            );
            return await RestSdk.deleteData(
                `/api/studio/chat/message?ids=${_ids.join(",")}&sessionId=${sessionId}`,
                {}
            );
        },
        [sessionId]
    );

    //-----------USECHAT OVERWITES------------
    // BYPASSING the original handle submit
    const handleSubmit = async (
        text: string,
        event?: {
            preventDefault?: () => void;
        },
        chatRequestOptions?: ChatRequestOptions
    ) => {
        console.log("[handleSubmit] called with:", { text, chatRequestOptions });
        // first store the lastmessage to db
        const newMessage: UIMessage = {
            id: crypto.randomUUID(),
            role: "user",
            parts: [
                {
                    type: "text",
                    text: text,
                },
            ],
        };
        if (event) {
            event.preventDefault?.();
        }
        setInput("");
        console.log("[handleSubmit] created new message:", newMessage);
        await appendMessage({ message: newMessage, chatRequestOptions });
        console.log("[handleSubmit] finished.");
    };

    /** should prefill the minion annotation */
    const appendMessage = useCallback(
        async ({
            message,
            chatRequestOptions,
            bypassDb,
            bypassAi,
        }: {
            message: UIMessage;
            chatRequestOptions?: ChatRequestOptions;
            bypassDb?: boolean;
            bypassAi?: boolean;
        }) => {
            console.log("[appendMessage] called with:", {
                message,
                chatRequestOptions,
                bypassDb,
            });

            if (
                !sessionId &&
                !(chatRequestOptions?.body as any)?.sessionId &&
                sessionId == "undefined"
            ) {
                toast.error("Chat session not initialized. Please try again.");
                return;
            }

            const bodyParams = {
                ...chatRequestOptions?.body,
                ...(sessionId ? { sessionId: sessionId } : {}),
            };
            console.log("[appendMessage] Constructed bodyParams:", bodyParams);

            let messageNew = {
                ...message,
                id: message.id
                    ? sessionId && message.id.startsWith(sessionId)
                        ? message.id
                        : sessionId + "-" + message.id
                    : crypto.randomUUID(),
                metadata: {
                    ...bodyParams,
                    ...(message.metadata || {}),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            };
            console.log("[appendMessage] Constructed messageNew:", messageNew);

            const promises = []
            if (!bypassDb) {
                console.log("[appendMessage] Storing user message to DB...");
                promises.push(createMessage(messageNew));
                console.log("[appendMessage] Stored user message to DB.");
            }

            console.log("[appendMessage] Calling chatOptions.sendMessage with:", {
                messageNew,
                chatRequestOptions: { ...chatRequestOptions, body: bodyParams },
            });
            if (!bypassAi) {
                promises.push(chatOptions.sendMessage(messageNew, {
                    ...chatRequestOptions,
                    body: bodyParams,
                }));
            } else {
                promises.push(chatOptions.setMessages((messages) => [...messages, messageNew]));
            }
            await Promise.all(promises);
        },
        [
            sessionId
        ]
    );

    const handleEditMessage = async (messageIndex: number) => {
        if (messageIndex >= chatOptions.messages.length) {
            return;
        }
        // show alert dialog to confirm the edit
        const messageToEdit = { ...chatOptions.messages[messageIndex] };
        if (messageToEdit.role !== "user") {
            console.error("Cannot edit an assistant message index.");
            toast.error("Cannot edit from this point.");
            return;
        }
        chatOptions.stop();

        const newTextInput = getTextParts(
            messageToEdit as UIMessage<any, any, any>
        );
        setInput(newTextInput?.[0] ?? "");

        const messagesToDelete = chatOptions.messages.slice(messageIndex);
        if (messagesToDelete.length > 0) {
            const response = await deleteMessages(messagesToDelete.map((m) => m.id));
            console.log("deleted messages", response);
        }

        chatOptions.setMessages((messages) => {
            let newMessages = messages.slice(0, messageIndex);
            if (!newMessages || newMessages.length === 0) {
                newMessages = [];
            }
            return newMessages;
        });
    };

    const handleRefresh = async (messageIndex: number) => {
        if (messageIndex >= chatOptions.messages.length) {
            return;
        }

        const messageToResend = { ...chatOptions.messages[messageIndex] }; // The user message to resend
        if (messageToResend.role !== "user") {
            console.error("Cannot refresh from an assistant message index.");
            toast.error("Cannot refresh from this point.");
            return;
        }

        chatOptions.stop();
        // Extract body parameters from annotations
        const bodyParams = messageToResend.metadata;

        const messagesToDelete = chatOptions.messages.slice(messageIndex + 1); // Assistant response and subsequent messages
        if (messagesToDelete.length > 0) {
            const response = await deleteMessages(messagesToDelete.map((m) => m.id));
            console.log("deleted messages", response);
        }

        chatOptions.setMessages((messages) => {
            const newMessages = messages.slice(0, messageIndex);
            return newMessages;
        });

        if (messageToResend) {
            try {
                // Resend the user message, triggering backend processing again
                await appendMessage({
                    message: messageToResend as UIMessage,
                    chatRequestOptions: { body: bodyParams },
                    bypassDb: true,
                    bypassAi: false,
                });
            } catch (error) {
                console.log("error appending message during refresh", error);
                toast.error("Failed to refresh. Please try again.");
            }
        }
    };

    const [input, setInput] = useState("");

    return {
        ...chatOptions,
        handleSubmit,
        append: appendMessage,
        mutate,
        isLoading,
        isValidating,
        serverMessages,
        handleRefresh,
        handleEditMessage,
        input,
        setInput,
    };
};

export const AppChatProvider: React.FC<AppChatProviderProps> = ({
    children,
    chatOptions: userChatOptions,
    sessionId,
}) => {
    const value = useAppContext(userChatOptions, sessionId);
    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
};

// Custom hook to use the App context
export const useAppChat = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error("useApp must be used within a AppProvider");
    }
    return context;
};
