import { useComponents } from "@/components/studio/context/ComponentProvider";
import { getLastActiveToolPart } from "@/components/studio/context/helpers/parts";
import { useMessageParts } from "@/components/studio/context/MessageProvider";
import { ToolUIPart } from "ai";

/**
 * Render the footer for the previous step / tool call. 
 * @returns 
 */
export const RenderToolFooter = () => {
    const { activePart, setActivePart, displayParts, message } = useMessageParts();
    const { aiRouterMetadata, getToolComponent } = useComponents();
    const lastActiveToolPart = getLastActiveToolPart(message, activePart, displayParts) as ToolUIPart;

    const FooterComponent = lastActiveToolPart ?
        getToolComponent(lastActiveToolPart.type, "footer_sticky")
        : null;
    if (FooterComponent) {
        return <FooterComponent tool={lastActiveToolPart as any} isStickyRender={true} />
    }

    //const { toolName, mcpName } = parseMcpType(lastActiveToolPart?.type ?? "");
    // const packageNames = toolPackages.map((p) => p.packageName).join(",");

    // 1. check for the tooLPart that is last & display its banner.

    //console.log("lastActiveToolPart", lastActiveToolPart);
    // if (mcpName === "brave" && lastActiveToolPart.state == "output-available") {
    //     return <BraveSourceBanner toolName={toolName} output={((lastActiveToolPart.output as any)?.ui as UiComponentProps["hitl_output"])?.object?.brave} />
    // }

    return null;
}