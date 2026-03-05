import { UIMessage } from "@ai-sdk/react";
import { convertToModelMessages, ToolCallPart, ToolResultPart } from "ai";

export const findLastElement = <T>(array: T[]) => {
  return array[array.length - 1];
};

export const findFirstElement = <T>(array: T[]) => {
  return array[0];
};

export const findLastElementWith = <T>(
  array: T[],
  predicate: (element: T) => boolean
) => {
  let new_array = array.filter(predicate);
  if (!new_array) {
    return null;
  }
  return new_array?.[new_array.length - 1];
};

export const trimMessagesForModel = (
  messages: UIMessage<any, any>[],
  offset?: number
) => {
  // trim to the last 8
  let trimmedMessages;
  if (offset && messages.length > offset) {
    trimmedMessages = messages.slice(offset);
  } else {
    trimmedMessages = messages.length > 8 ? messages.slice(-8) : messages;
  }
  return trimmedMessages;
};

export const cleanUiMessageParts = (
  messages: UIMessage<any, any>[],
  options?: {
    removeAllToolCallsExceptLast?: boolean; // false by default
    keepUIinLastMessage?: boolean; // false by default
    removeToolCalls?: boolean; // false by default
    onlyLastText?: boolean; // false by default
  }
) => {
  let processedMessages = messages.map((m) => ({
    ...m,
    parts: m?.parts.map((p) => ("input" in p ? p : { ...p, input: {} })),
  }));

  //processedMessages = processedMessages.filter((m) => );

  if (options?.removeToolCalls) {
    processedMessages = processedMessages.map((m) => ({
      ...m,
      parts: m?.parts.filter((p) => !p.type?.startsWith("tool-")),
    }));
  }

  if (options?.removeAllToolCallsExceptLast) {
    processedMessages = processedMessages.map((m, index) => ({
      ...m,
      parts:
        index === processedMessages.length - 1
          ? options?.keepUIinLastMessage
            ? m?.parts
            : m?.parts?.map((p) => ({
                ...p,
                ...((("output" in p) as any)
                  ? { output: { ...(p as any).output, ui: undefined } }
                  : {}),
              }))
          : m?.parts.map((p) =>
              p.type?.startsWith("tool-")
                ? {
                    type: p.type as `tool-${string}`,
                    toolCallId: (p as any)?.toolCallId!,
                    input: p.input,
                    state:
                      (p as any)?.state === "input-streaming"
                        ? "output-available"
                        : (p as any)?.state,
                    output: "This tool call was successfully executed.",
                  }
                : p
            ),
    }));
  }

  if (options?.onlyLastText) {
    processedMessages = processedMessages.map((m) => ({
      ...m,
      parts: [
        findLastElementWith(m?.parts, (p) => p.type === "text") || {
          type: "text",
          text: "",
          input: {},
        },
      ],
    }));
  }

  // console.log(
  //   "processedMessages",
  //   JSON.stringify(convertToModelMessages(processedMessages), null, 2)
  // );
  return processedMessages;
};
