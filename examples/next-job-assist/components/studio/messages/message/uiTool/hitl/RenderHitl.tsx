// import { UiComponentProps } from "@/components/screens/Chat/message/uiTool/mappers/UiComponentProps"
// import { MyUiTool } from "@/components/screens/Chat/message/uiTool/mappers/uiTool"
// import { AcceptHitl } from "./Accept"
// import { ToolUIPart } from "ai"



// /**
//  * RenderUiTool is a component that renders a UI tool (tool-ui-<component>) or sticky parts (tool-<component>).
//  * usually all hitl or sticky parts (but better make a seperation by them having tool-hitl-)
//  * @param param0 
//  * @returns 
//  */
// export const RenderHiltTool = ({ tool, lastMessage, lastAnnotationIndices, messageIndex }: {
//     tool: MyUiTool & {
//         type: `tool-ui-${keyof UiComponentProps}` | `tool-${string}`
//     },
//     lastMessage: boolean
//     lastAnnotationIndices: Map<string, number>,
//     messageIndex: number
// }) => {

//     switch (tool.output?.props?.uiType) {
//         case "hitl":
//             return <AcceptHitl
//                 tool={tool as ToolUIPart}
//                 lastMessage={lastMessage}
//             />
//         default:
//             return null;
//     }

//     return null;
// }