/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { UIMessage } from "ai";
import {
    ChevronRight,
    FileText,
    RefreshCw,
    XIcon
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppSession } from "../context/AppSessionProvider";
import { useFileUpload } from "../context/FileUploadProvider";
// import { McpSelect } from "./input/McpSelect";
import { ToolSpeed } from "./ToolSpeed";
import { constructAutoSubmitMessage } from "../context/AppSessionProvider";
import { useAppChat } from "../context/AppChatProvider";
interface ChatInputBoxProps {
    messageStatus: "pending" | "streaming" | "submitted" | "ready" | "error";
    className?: string;
    lastMessage?: UIMessage;
}

export default function ChatInputBox({
    messageStatus,
    lastMessage,
    className,
}: ChatInputBoxProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { attachedMedia, mediaUploadStatus, handleFileChange, removeMedia } =
        useFileUpload();
    const { submitMetadata, setSubmitMetadata, autoSubmit, setAutoSubmit } = useAppSession();
    const { handleSubmit, messages, status, append, input, setInput } = useAppChat();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        //console.log("textareaRef", textareaRef.current);
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`; // Expand to fit content
        }
    }, [input]); // Runs when input changes

    const handleFileInputChange = async (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        if (e.target.files) {
            await handleFileChange(
                e.target.files,
                "user",
                "customBots/clientMessages"
            );
            e.target.value = "";
        }
    };

    const handleCustomInputChange = (
        e: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
        setInput(e.target.value);
    };

    const handleSend = (e?: any) => {
        if (status === "streaming") {
            return;
        }
        const isFirstMessage = messages.length === 0;
        const extraBody = {
            ...submitMetadata
        }
        setSubmitMetadata({});
        setAutoSubmit(null);
        handleSubmit(input, e, {
            body: {
                // toolMode: toolMode,
                // selectedMcps: selectedMcps.map((mcp) => mcp.id),
                ...extraBody
            }
        });
    }

    const apiErrors = submitMetadata.api_errors;
    useEffect(() => {
        if (apiErrors?.length > 0) {
            setInput("Fix the following")
            textareaRef.current?.focus();
        }
    }, [apiErrors]);

    useEffect(() => {
        if (autoSubmit && autoSubmit.length > 0) {
            append({
                message: constructAutoSubmitMessage(autoSubmit), chatRequestOptions: {
                    body: {
                        ...submitMetadata
                    }
                }
            });
            setAutoSubmit(null);
            setSubmitMetadata({});
        }
    }, [autoSubmit, submitMetadata]);

    return (
        <div className={cn("w-full overflow-visible", className)}>
            {attachedMedia.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                    {attachedMedia.map((media, index) => (
                        <div key={index} className="relative">
                            {media.file.type.startsWith("image/") ? (
                                <img
                                    src={media.preview}
                                    alt={media.file.name}
                                    className="h-16 w-16 rounded object-cover"
                                />
                            ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded bg-gray-100">
                                    <FileText className="h-6 w-6 text-gray-600" />
                                </div>
                            )}
                            <button
                                onClick={() => removeMedia(index)}
                                className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-xs text-white"
                            >
                                X
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex flex-col gap-2 !rounded-4xl shadow-md border border-gray-200 bg-white p-3 relative">
                <textarea
                    ref={textareaRef}
                    placeholder="Ask anything"
                    className="overflow-y-auto bg-transparent px-2 py-2 text-gray-800 placeholder-gray-500 outline-none resize-none min-h-[42px] max-h-[500px]"
                    value={input}
                    onChange={handleCustomInputChange}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            handleSend(e);
                        }
                    }}
                    disabled={
                        messageStatus === "pending" ||
                        messageStatus === "streaming" ||
                        mediaUploadStatus === "UPLOADING" ||
                        mediaUploadStatus === "ERROR"
                    }
                />
                <div className="flex w-full items-center justify-between">
                    {/* <button
            className="p-2 h-fit ml-2 border border-gray-300 rounded-full text-gray-500 hover:text-gray-700"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-5 w-5" />
          </button> */}
                    <div className="flex flex-row gap-2 px-2">
                        {/* <ToolSpeed /> */}
                        {apiErrors?.value?.length > 0 && (
                            <div className="text-sm flex flex-row gap-2 items-center bg-gray-100 rounded-full px-4 py-[2px] text-gray-500">
                                {apiErrors?.value?.length} Logs attached
                                <XIcon
                                    onClick={() => {
                                        setSubmitMetadata((sm: any) => ({
                                            ...sm,
                                            api_errors: undefined
                                        }))
                                    }}
                                    className="h-4 w-4 cursor-pointer" />
                            </div>
                        )}
                    </div>
                    <div className="flex flex-row gap-2">
                        {/* <McpSelect /> */}
                        <button
                            onClick={() => handleSend()}
                            disabled={
                                // (
                                //   lastMessage?.annotations?.[
                                //   lastMessage.annotations.length - 1
                                //   ] as any
                                // )?.type === "ui" ||
                                (!input?.trim() && attachedMedia.length === 0) ||
                                messageStatus === "pending" ||
                                messageStatus === "streaming" ||
                                mediaUploadStatus === "UPLOADING" ||
                                mediaUploadStatus === "ERROR"
                            }
                            className="rounded-full mr-2 bg-black p-2 text-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed hover:bg-black/80"
                        >
                            {!(
                                messageStatus === "streaming" ||
                                messageStatus === "pending" ||
                                mediaUploadStatus === "UPLOADING"
                            ) ? (
                                <ChevronRight className="h-5 w-5" />
                            ) : (
                                <RefreshCw className="h-5 w-5 animate-spin" />
                            )}
                        </button>
                    </div>
                </div>
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileInputChange}
                />
            </div>
        </div>
    );
}
