import { UIMessage } from "ai";
import dayjs from "dayjs";
import { FileText, RefreshCcw, EditIcon } from "lucide-react";
import { useState } from "react";
import { getMessageClass } from "./messageHelpers";
import { useAppChat } from "../../context/AppChatProvider";
import { LoadingIndicator } from "./LoadingIndicator";
import { DisplayPart } from "./wrappers/DisplayPart";
import { RenderUiTool } from "./wrappers/RenderUiTool";
import { StickyUiPartsWrapper } from "./wrappers/StickyUiPartsWrapper";
import { RenderToolFooter } from "./wrappers/RenderToolFooter";
import { useMessageParts } from "../../context/MessageProvider";
import { StepBanner } from "./wrappers/Stepbanner";
import { RenderToolHeader } from "./wrappers/RenderToolHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

// TODO: error boundary for ui annotations
//import { ErrorBoundary } from "react-error-boundary";
interface MessageWrapperProps {
  message: UIMessage<any, any, any>;
  index: number;
  renderDateSeperator: (currentDate: string) => React.ReactNode;
  length: number;
}

// RENDER CONTENT BY PARTS AND NOT BY CONTENT, BECAUSE CONTENT MIGHT BE A MERGE OF MULTIPLE PARTS.
export const MessageWrapper = ({
  message,
  index,
  renderDateSeperator,
  length,
}: MessageWrapperProps) => {
  const { activePart, setActivePart, displayParts, toolParts, stickyUiParts } =
    useMessageParts();
  const { handleRefresh, status } = useAppChat();
  const [showEditConfirmation, setShowEditConfirmation] = useState(false);

  const onRefresh = async () => {
    await handleRefresh(index);
  };

  return (
    <div key={message.id + index}>
      <EditMessageConfirmationDialog
        showEditConfirmation={showEditConfirmation}
        onClose={() => setShowEditConfirmation(false)}
        index={index}
      />
      {message.metadata?.createdAt &&
        renderDateSeperator(
          new Date(message.metadata?.createdAt)?.toISOString()
        )}

      {message.role === "system" ? (
        <div className="my-2 text-center text-xs text-gray-600">
          {message.metadata?.content} •{" "}
          {message.metadata?.createdAt &&
            dayjs(message.metadata?.createdAt).format("h:mm A")}
        </div>
      ) : (
        <div
          className={`group flex items-start gap-3 ${(message.role as any) === "user" ? "justify-end" : "justify-start"}`}
        >
          {message.role == "user" && index <= length - 1 && (
            <>
              <RefreshCcw
                className="h-4 w-4 text-neutral-500 cursor-pointer self-center opacity-0 group-hover:opacity-100 hover:text-neutral-700"
                onClick={onRefresh}
              />
              <EditIcon
                className="h-4 w-4 text-neutral-500 cursor-pointer self-center opacity-0 group-hover:opacity-100 hover:text-neutral-700"
                onClick={() => {
                  setShowEditConfirmation(true);
                }}
              />
            </>
          )}
          <div
            className={`relative flex flex-col rounded-lg p-3 ${getMessageClass(message.role as any)} ${message.role === "user" ? "max-w-xs sm:max-w-md" : "w-full"}`}
          >
            {message.role != "user" && (
              <span
                className={`mb-3 text-[10px] font-light ${(message.role as any) === "user" ? "text-gray-500 ml-auto" : "text-gray-500 mr-auto"}`}
              >
                {message.metadata?.createdAt &&
                  dayjs(message.metadata?.createdAt).format("h:mm A")}
              </span>
            )}
            {status !== "streaming" &&
              message.role === "assistant" &&
              message.metadata?.error && (
                <div className="text-red-500">
                  {message.metadata?.error ||
                    "Something went wrong! Try again."}
                </div>
              )}
            {message.role === "assistant" &&
              status === "streaming" &&
              index === length - 1 && (
                <LoadingIndicator message={message} />
              )}
            {message?.parts &&
              message?.parts?.length > 0 &&
              displayParts.length === 1 && (
                <DisplayPart
                  part={displayParts?.[0] as any}
                  messageId={message.id}
                  lastMessage={index === length - 1}
                  messageIndex={index}
                  message={message}
                />
              )}
            {displayParts.length > 1 && (
              <div
                className={`${message.role === "user" ? "w-[400px]" : "w-full"} p-0 bg-transparent`}
              >
                <StepBanner />
                {toolParts && toolParts?.length > 0 && <RenderToolHeader />}
                {displayParts?.[activePart] && (
                  <DisplayPart
                    part={displayParts?.[activePart]}
                    messageId={message.id}
                    lastMessage={index === length - 1}
                    messageIndex={index}
                    message={message}
                  />
                )}
                {toolParts && toolParts?.length > 0 && <RenderToolFooter />}
              </div>
            )}
            {stickyUiParts.length > 0 && (
              <StickyUiPartsWrapper>
                {stickyUiParts.map((part) => (
                  <RenderUiTool
                    key={part.toolCallId}
                    tool={part as any}
                    lastMessage={index === length - 1}
                    messageIndex={index}
                  />
                ))}
              </StickyUiPartsWrapper>
            )}
            {message.metadata?.attachments && (
              <div className="mt-2 flex flex-wrap justify-evenly gap-2">
                {message.metadata?.attachments.map((m: any, idx: number) =>
                  m?.mediaType?.startsWith("image") ? (
                    <img
                      key={idx}
                      src={m.mediaUrl}
                      alt={m.mediaName}
                      className={`rounded object-cover ${(message.role as any) === "user" ? "max-h-60" : "max-h-20"}`}
                    />
                  ) : (
                    <a key={idx} href={m.mediaUrl} target="_blank">
                      <span className="flex items-center gap-1">
                        <FileText className="h-12 w-12 text-gray-600" />
                        {m.mediaName}
                      </span>
                    </a>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const EditMessageConfirmationDialog = ({
  showEditConfirmation,
  onClose,
  index,
}: {
  showEditConfirmation: boolean;
  onClose: () => void;
  index: number;
}) => {
  const { handleEditMessage } = useAppChat();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onEdit = () => {
    setIsLoading(true);
    handleEditMessage(index)
      .then(() => {
        onClose();
      })
      .catch((error) => {
        setError(error.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };
  return (
    <Dialog open={showEditConfirmation} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Message</DialogTitle>
          <DialogDescription>
            Are you sure you want to edit this message? This action cannot be
            undone and will delete all messages that came after this one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onEdit} disabled={isLoading}>
            Edit
          </Button>
          {error && <p className="text-red-500">{error}</p>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
