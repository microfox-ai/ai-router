import { ToolUIPart, UIMessage, UIMessagePart } from "ai";
import { useAppChat } from "../../../context/AppChatProvider";
import { MessageMarkdown } from "@/components/studio/global/MessageThoughtWrapper";
import { RenderToolInput } from "./RenderToolInput";
import { RenderToolOutput } from "./RenderToolOutput";
import { RenderUiTool } from "./RenderUiTool";
import { useComponents } from "@/components/studio/context/ComponentProvider";

type MessagePartType = UIMessage["parts"][number];

const MessagePart = ({
    part,
    messageId,
    message
}: {
    part: MessagePartType;
    messageId: string;
    message: UIMessage;
}) => {

    const { status, messages } = useAppChat();
    if (part.type === "text") {
        return (
            <div className={`flex flex-col text-md ${message.role === "user" ? "" : "p-4"}`}>
                <MessageMarkdown isStreaming={status === "streaming"}>{part.text}</MessageMarkdown>
            </div>
        );
    }


    if (part.type === "source-url") {
        return <MessageMarkdown isStreaming={status === "streaming"}>{part.sourceId}</MessageMarkdown>;
    }
};

export const DisplayPart = ({ part, messageId, lastMessage, messageIndex, message }: {
    part: UIMessagePart<any, any>,
    messageId: string,
    lastMessage: boolean
    messageIndex: number;
    message: UIMessage;
}) => {
    const { getToolComponent, getDataComponent } = useComponents();

    if (part.type === "text") {
        return <MessagePart
            part={part}
            messageId={messageId}
            message={message}
        />
    }
    if (part.type.startsWith("tool-ui-")) {
        return <RenderUiTool tool={part as any} lastMessage={lastMessage} messageIndex={messageIndex} />
    }
    if (part.type.startsWith("tool-") && (part as any).state == "output-available" && (part as any).output) {
        // if (part.type.match(/summary/i) && (part as any).output?.summary) {
        //     return (
        //         <div className="flex flex-col gap-2 text-xs">
        //             <MessageMarkdown>{(part as any).output?.summary}</MessageMarkdown>
        //         </div>
        //     )
        // }
        const FullComponent = getToolComponent(part.type, "full");
        if (FullComponent) {
            return <FullComponent tool={part as any} />
        }

        return (
            <div className="flex flex-col gap-2">
                <RenderToolInput tool={part as any} />
                <RenderToolOutput
                    tool={part as ToolUIPart<any>}
                />
            </div>
        )
    }
    if (part.type.startsWith("data-") && (part as any).data) {
        const FullComponent = getDataComponent(part.type, "full");
        if (FullComponent) {
            return <FullComponent data={part as any} />
        }
    }
    return null;
}