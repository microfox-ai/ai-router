
import { UIMessage } from "@ai-sdk/react";
import {
  MessageCircle,
  Mail,
  Instagram,
  Slack,
  Send,
  Twitter,
  Phone,
  Youtube,
  Settings,
} from "lucide-react";

/**
 * Helper functions for constructing message objects for the chat interface
 */

/**
 * Constructs a message object from a button for appendMessage action
 */
export const constructMessageFromButton = (button: any) => {
  return {
    id: crypto.randomUUID(),
    content: button.value ?? button.text,
    role: 'user' as const,
    parts: [
      {
        type: 'text' as const,
        text: button.value ?? button.text,
      },
    ],
  };
};

export const constructAutoSubmitMessage = (autoSubmit: string) => {
  return {
    id: crypto.randomUUID(),
    content: autoSubmit,
    role: 'user' as const,
    parts: [
      {
        type: 'text' as const,
        text: autoSubmit,
      },
    ],
  };
};

export const constructAutoSubmitBody = (autoSubmitAnnotations: any[]) => {
  return autoSubmitAnnotations.reduce((acc: any, annotation: any) => {
    if (annotation.type === 'body') {
      acc[annotation.key] = annotation.value;
      return acc;
    }
    return acc;
  }, {});
};

/**
 * Constructs a message object for shiftMinion action
 */
export const constructShiftMinionMessage = (button: any) => {
  return {
    id: crypto.randomUUID(),
    content: button.actionText ?? button.text ?? 'Changing gears..',
    role: 'user' as const,
    parts: [
      {
        type: 'text' as const,
        text: button.actionText ?? button.text ?? 'Changing gears..',
      },
    ],
  };
};

/**
 * Constructs the body object for append function
 */
export const constructAppendBody = (minionType: string, extraProps?: any) => {
  return {
    body: {
      minionType,
      ...(extraProps ?? {}),
    },
  };
};



export const getTemplateIcon = (type?: string) => {
  switch (type) {
    case "DISCORD":
      return <MessageCircle className="mr-2 h-5 w-5" />;
    case "EMAIL":
      return <Mail className="mr-2 h-5 w-5" />;
    case "INSTAGRAM":
      return <Instagram className="mr-2 h-5 w-5" />;
    case "SLACK":
      return <Slack className="mr-2 h-5 w-5" />;
    case "TELEGRAM":
      return <Send className="mr-2 h-5 w-5" />;
    case "X":
      return <Twitter className="mr-2 h-5 w-5" />;
    case "WHATSAPP":
      return <Phone className="mr-2 h-5 w-5" />;
    case "YOUTUBE":
      return <Youtube className="mr-2 h-5 w-5" />;
    default:
      return <Settings className="mr-2 h-5 w-5" />; // For CUSTOM or undefined types.
  }
};

export const getMessageClass = (role: UIMessage["role"]) => {
  switch (role) {
    case "user":
      return "bg-neutral-100 text-black";
    case "assistant":
      return "bg-transparent text-black";
    case "system":
      return "bg-gray-300 text-gray-700 text-center italic";
    default:
      return "bg-gray-100 text-black";
  }
};

const statusVariantMapping: Record<string, { variant: string; color: string }> =
{
  UN_ASSIGNED: { variant: "secondary", color: "#a4a7ae" },
  IN_DEVELOPMENT: { variant: "default", color: "#3b82f6" },
  IN_REVIEW: { variant: "warning", color: "#f59e0b" },
  CLOSED: { variant: "error", color: "#ef4444" },
  COMPLETED: { variant: "success", color: "#10b981" },
};

