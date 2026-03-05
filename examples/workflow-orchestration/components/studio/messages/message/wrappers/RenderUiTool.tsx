import { UITools } from "@microfox/ai-router"
// import { ActionButtons } from "../uiTool/buttons_list/ActionButtons"
// import { AcceptHitl } from "../uiTool/hitl/Accept"
// import { HitlAuthWrapper } from "../uiTool/hitl/HitlWrapper"
// import { RenderHiltTool } from "../uiTool/hitl/RenderHitl"
import { ToolUIPart } from "ai"

/**
 * RenderUiTool is a component that renders a UI tool (tool-ui-<component>) or sticky parts (tool-<component>).
 * usually all hitl or sticky parts (but better make a seperation by them having tool-hitl-)
 * @param param0 
 * @returns 
 */
export const RenderUiTool = ({ tool, lastMessage, messageIndex }: {
    tool: ToolUIPart<UITools>,
    lastMessage: boolean
    messageIndex: number
    bypassHitlAuth?: boolean
}) => {
    if (!tool.output) {
        return null;
    }
    //const isLastInQueue = lastAnnotationIndices.get(tool.output.uiComponent) === messageIndex;
    if ((tool.output as any)?._humanIntervention) {
        const manipulated_tool = {
            ...tool,
            output: {
                ...tool.output,
                props: {
                    ...(tool.output as any).props,
                    uiType: "hitl" as const,
                }
            }
        }

        // if ((tool.output as HitlInput).auth?.secrets?.length > 0) {
        //     return (
        //         <HitlAuthWrapper
        //             tool={tool}
        //             lastMessage={lastMessage}
        //             lastAnnotationIndices={lastAnnotationIndices}
        //             messageIndex={messageIndex}
        //         >
        //             <RenderHiltTool
        //                 tool={manipulated_tool}
        //                 lastMessage={lastMessage}
        //                 lastAnnotationIndices={lastAnnotationIndices}
        //                 messageIndex={messageIndex}
        //             />
        //         </HitlAuthWrapper>
        //     )
        // }
        // else {
        // return (
        //     <AcceptHitl
        //         tool={tool as ToolUIPart}
        //         lastMessage={lastMessage}
        //     />
        // )
        // }
    }
    switch ((tool.output as any)?.props?.uiType) {
        // case "buttons_list":
        //     return <ActionButtons
        //         {...(tool.output as any).props}
        //         lastMessage={lastMessage}
        //     />
        // case "taskIntegrations":
        //     return <TaskIntegrations
        //         {...tool.output.props}
        //     />
        // case "taskStructure":
        //     return <TaskStructure
        //         {...tool.output.props}
        default:
            return null;
    }
}