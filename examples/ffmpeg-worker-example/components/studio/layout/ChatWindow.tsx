"use client";

import { Tabs } from "@/components/ui/tabs";
import { StudioConfig } from "@/microfox.config";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppChat } from "../context/AppChatProvider";
import { useAppSession } from "../context/AppSessionProvider";
import { useChatUI } from "../context/ChatUiProvider";
import { useLayout } from "../context/LayoutProvider";
import { useTabUi } from "../context/TabUiProvider";
import ChatInputBox from "../input/ChatInputBox";
import MessageList from "../messages/MessageList";
import ChatHeader from "./ChatHeader";

export type AttachedMedia = {
    file: File;
    preview: string;
};

function ChatWindow() {
    // Chat state
    const {
        messages,
        status,
        isLoading,
        serverMessages,
    } = useAppChat();
    const { isLeftCollapsed: isCollapsed, handleLeftCollapse: onCollapse } = useLayout();
    const { session, isLoading: isSessionLoading } = useAppSession();

    const {
        activeTab,
        setActiveTab,
        setPreviousTab,
        getSlideDirection
    } = useTabUi();

    const router = useRouter();

    const { hasScrolled, setHasScrolled, messagesEndRef, scrollToBottom } = useChatUI();
    const { isRightCollapsed, handleRightCollapse } = useLayout();

    const handleTabChange = (value: string) => {
        setPreviousTab(activeTab);
        setActiveTab(value as "chat" | "dashboard" | "history" | "code");
        // Reset scroll state when switching tabs
        if (value !== "chat") {
            setHasScrolled(false);
        }
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (!hasScrolled && activeTab === "chat") {
            setHasScrolled(true);
        }
    };

    useEffect(() => {
        if (activeTab === "chat") {
            scrollToBottom();
        }
    }, [messages, activeTab]);

    return (
        <div className="relative flex h-full w-full flex-col">
            <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className="relative h-screen gap-0"
            >
                <div className="flex items-start w-full">
                    {/* {isCollapsed && (
            <ButtonSCN
              variant="ghost"
              size="icon"
              className=" ml-4 mt-6"
              onClick={() => onCollapse?.(!isCollapsed)}
            >
              <PanelRightIcon style={{ height: "1rem", width: "1rem" }} />
            </ButtonSCN>
          )} */}
                    <ChatHeader
                        messages={messages}
                        projectTitle={StudioConfig.appName}
                        session={session}
                        isChatLoading={isSessionLoading}
                        isLoading={isLoading}
                        isValidating={isLoading}
                        activeTab={activeTab}
                        setActiveTab={handleTabChange}
                    />
                    {/* {isRightCollapsed && (
            <ButtonSCN
              variant="outline"
              size="icon"
              className="shadow-none mt-6 !p-px mx-2 mr-4 text-gray-400 hover:text-gray-500 border-gray-300"
              onClick={() => handleRightCollapse(false)}
            >
              <ChevronsRight
                strokeWidth={2.5}
                style={{ height: "1rem", width: "1rem" }}
              />
            </ButtonSCN>
          )} */}
                </div>

                {(isSessionLoading || isLoading) && (
                    <div className="w-full flex justify-center h-full items-center">
                        <Loader2 className="w-full h-6 animate-spin" />
                    </div>
                )}

                {!isSessionLoading &&
                    !isLoading &&
                    ((serverMessages && serverMessages.length > 0) ||
                        messages.length > 0) /* Chat Tabs */ ? (
                    <AnimatePresence mode="sync" initial={false}>
                        <div className="relative flex-1 overflow-hidden">
                            {activeTab === "chat" && (
                                <motion.div
                                    key="chat"
                                    initial={{ x: getSlideDirection("chat") }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 30,
                                        duration: 0.1,
                                    }}
                                    style={{
                                        WebkitMaskImage:
                                            "linear-gradient(to bottom, transparent, white 4%, white 96%, transparent)",
                                        maskImage:
                                            "linear-gradient(to bottom, transparent, white 4%, white 96%, transparent)",
                                    }}
                                    className={`w-full h-full overflow-y-auto mt-4 ${hasScrolled ? "thin-scrollbar" : "scrollbar-hidden"}`}
                                    onScroll={handleScroll}
                                >
                                    <div className="w-full max-w-[800px] pr-3 mx-auto pt-10">
                                        <MessageList
                                            isLoading={false}
                                        />
                                    </div>
                                </motion.div>
                            )}
                            {activeTab === "dashboard" && (
                                <motion.div
                                    key="dashboard"
                                    initial={{ x: getSlideDirection("dashboard") }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 30,
                                        duration: 0.1,
                                    }}
                                    className=" w-full h-full overflow-y-auto thin-scrollbar"
                                >
                                    <div className="p-4 h-full mx-auto">
                                        Dashboard
                                    </div>
                                </motion.div>
                            )}
                            {activeTab === "code" && (
                                <motion.div
                                    key="code"
                                    className="w-full h-[90vh] overflow-y-auto thin-scrollbar"
                                >
                                    <div className="p-4 h-full mx-auto">
                                        Code
                                    </div>
                                </motion.div>
                            )}
                            {activeTab === "history" && (
                                <motion.div
                                    key="history"
                                    className="w-full h-[90vh] overflow-y-auto thin-scrollbar"
                                >
                                    <div className="p-4 h-full mx-auto">
                                        History
                                    </div>
                                </motion.div>
                            )}
                            {activeTab === "publish" && (
                                <motion.div
                                    key="publish"
                                    className="w-full h-[90vh] overflow-y-auto thin-scrollbar"
                                >
                                    <div className="p-4 h-full mx-auto">
                                        Publish
                                    </div>
                                </motion.div>
                            )}
                        </div>

                        <motion.div
                            key={"chat-input"}
                            className="bottom-0 pb-4 z-50 mx-auto left-0 right-0 w-full max-w-[800px] overflow-visible"
                            initial={{ x: getSlideDirection("chat"), opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ duration: 0.1 }}
                        >
                            {activeTab === "chat" && (
                                <ChatInputBox
                                    key={"chat-input"}
                                    lastMessage={messages[messages.length - 1]}
                                    messageStatus={status}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                ) : (
                    !isSessionLoading &&
                    !isLoading &&
                    messages.length === 0 &&
                    (!serverMessages || serverMessages.length === 0) && (
                        <div className="flex relative -mt-10 flex-col gap-4 justify-center items-center h-full">
                            <h1 className="text-4xl font-bold">
                                What can I do for you?
                            </h1>
                            <p className="text-gray-500">
                                Please select a tool/agent from the bottom right for better results.
                            </p>
                            <ChatInputBox
                                messageStatus={status}
                                className="relative max-w-[800px]"
                            />
                        </div>
                    )
                )}
            </Tabs>
        </div>
    );
}

export default function ChatWindowWithProvider() {
    return (
        <ChatWindow />
    );
}
