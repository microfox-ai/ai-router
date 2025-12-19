import { useComponents } from "@/components/studio/context/ComponentProvider";
import { useMessageParts } from "@/components/studio/context/MessageProvider";
import { getLastActiveToolPart } from "@/components/studio/context/helpers/parts";
import { ToolUIPart } from "ai";

/**
 * Render the header for the current step / tool call.
 * @returns 
 */
export const RenderToolHeader = () => {
    const { activePart, setActivePart, displayParts, message } = useMessageParts();
    const { aiRouterMetadata, getToolComponent } = useComponents();
    const lastActiveToolPart = getLastActiveToolPart(message, activePart, displayParts) as ToolUIPart;

    const HeaderComponent =
        lastActiveToolPart ?
            getToolComponent(lastActiveToolPart.type, "header_sticky")
            : null;

    if (HeaderComponent) {
        return <HeaderComponent tool={lastActiveToolPart as any} isStickyRender={true} />
    }

    //console.log("lastActiveToolPart", mcpName, toolName, lastActiveToolPart);
    // const packageNames = toolPackages.map((p) => p.packageName).join(",");

    // 1. check for the tooLPart that is last & display its banner.

    //console.log("lastActiveToolPart", lastActiveToolPart);
    // if (mcpName === "brave" && lastActiveToolPart.state == "output-available") {
    //     return <BraveSourceHeader toolName={toolName} output={((lastActiveToolPart.output as any)?.ui as UiComponentProps["hitl_output"])?.object?.brave} />
    // }

    return null
}