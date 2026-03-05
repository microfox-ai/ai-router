import { useComponents } from "@/components/studio/context/ComponentProvider";
import { cn } from "@/lib/utils";
import { ToolUIPart } from "ai";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export const RenderToolInput = ({ tool }: {
    tool: ToolUIPart<any>
}) => {
    const [expanded, setExpanded] = useState(false);
    const toolOutput = tool.output as any;
    const toolInput = tool.input as any;

    const { getToolComponent, aiRouterMetadata } = useComponents();
    const InputComponent = getToolComponent(tool.type, "input");
    if (InputComponent) {
        return <InputComponent tool={tool as any} />
    }

    //const { mcpName, toolName } = parseMcpType(tool.type);
    //const auth = toolOutput.auth;
    const toolKey = tool.type.replace("tool-", "");

    const toolInfo = aiRouterMetadata[toolKey as keyof typeof aiRouterMetadata];

    const title = toolOutput?.toolSummary || `${toolInfo?.title}`;
    const description = toolInput?.microfoxReasoning || toolInput?.body?.microfoxReasoning || toolInfo?.description;

    return (
        <div className="flex flex-col gap-2 p-4 rounded-xl bg-white hover:bg-gray-50 transition-colors cursor-pointer mb-2 max-w-xs sm:max-w-md">
            <div className="flex flex-row justify-between items-start cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex flex-row gap-3 items-center">
                    {toolInfo?.metadata?.icon && (
                        <img src={toolInfo.icon} alt={toolInfo.title} className="w-4 h-4 rounded-full" />
                    )}
                    <div className="flex flex-col">
                        <span className="font-semibold">{title}</span>
                        {description && (
                            <p className="text-sm text-gray-500 line-clamp-1">{description}</p>
                        )}
                    </div>
                </div>
                <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
            </div>

            {expanded && Object.keys(toolInput || {}).length > 0 && (
                <div className="font-mono bg-gray-100 p-2 rounded text-xs mt-2 w-full overflow-x-auto">
                    <pre>{JSON.stringify(toolInput, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}
