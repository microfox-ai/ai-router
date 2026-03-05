// import { ToolResultPart, ToolUIPart } from "ai";
// import { Button } from "@/components/ui/button";
// import { useMicrofoxChat } from "../../../MicrofoxChatProvider";
// import { ToolMetadata } from "@microfox/tool-kit";
// import { useHitl } from "./HitlProvider";
// import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";
// import { useEffect, useState } from "react";
// import { Textarea } from "@/components/ui/textarea";
// import { cn } from "@/lib/utils";
// import isEqual from "lodash.isequal";
// import { useChatUI } from "../../../ChatUiProvider";
// import { motion, useMotionValue, useTransform, animate } from "framer-motion";
// import McpRegistry, { shouldShowReviewAction } from "./helpers/McpRegistry";
// import { parseMcpType } from "../mappers/uiHitl";
// import SlackToolRenderer from "./slack/SlackToolRenderer";
// import { useLayout } from "@/components/screens/providers/LayoutProvider";
// import { AgentInfo } from "@microfox/types";
// import useSWR from "swr";


// const YesNoButtons = ({
//     onYes,
//     onNo,
//     error,
//     toolCallId,
// }: {
//     onYes?: () => void;
//     onNo?: () => void;
//     error?: string | null;
//     toolCallId: string;
// }) => {
//     const { addHitlToolResult } = useHitl();

//     return (
//         <div className="flex gap-2 pt-2 justify-end items-stretch">
//             <Button
//                 variant="outline"
//                 className="h-full text-black"
//                 onClick={() => {
//                     addHitlToolResult({
//                         toolCallId,
//                         output: {
//                             approved: false,
//                         },
//                     });
//                     onNo?.();
//                 }}
//             >
//                 No
//             </Button>
//             <motion.div className="rounded-md p-[3px]">
//                 <Button
//                     variant="ghost"
//                     className="bg-black hover:bg-black/70 hover:text-white px-4 text-white p-0"
//                     onClick={() => {
//                         addHitlToolResult({
//                             toolCallId,
//                             output: {
//                                 approved: true,
//                             },
//                         });
//                         onYes?.();
//                     }}
//                     disabled={!!error}
//                 >
//                     <CheckIcon className="w-3 h-3" />
//                     <span className="text-sm">Yes</span>
//                 </Button>
//             </motion.div>
//         </div>
//     );
// };

// export const AcceptHitl = ({
//     tool,
//     lastMessage,
// }: {
//     tool: ToolUIPart<any>;
//     lastMessage: boolean;
// }) => {
//     const { addHitlToolResult, mutateInput } = useHitl();
//     const { setRightPanelContent, handleRightCollapse } = useLayout();
//     const { scrollToBottom } = useChatUI();
//     if (tool.state !== "output-available") {
//         return null;
//     }
//     const toolMetadata = tool.output.metadata;
//     const { mcpName, toolName, mcpType } = parseMcpType(tool.type as `tool-${string}`);
//     const { data: agentInfos, mutate: mutateAgentInfos } = useSWR<AgentInfo[]>(
//         mcpType != "" ? `/api/agents/infos?agentNames=${mcpName}` : null,
//         async (url: string) => {
//             const res = await fetch(url);
//             if (!res.ok) throw new Error("Failed to fetch agents");
//             return res.json();
//         }, {
//         revalidateOnFocus: false,
//     });
//     const agentInfo = agentInfos?.find(a => a.agentName === mcpName);


//     const [expanded, setExpanded] = useState(false);
//     const [showJson, setShowJson] = useState(false);

//     const [jsonString, setJsonString] = useState(
//         JSON.stringify(tool.input, null, 2)
//     );
//     const [error, setError] = useState<string | null>(null);

//     const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//         const newJsonString = e.target.value;
//         setJsonString(newJsonString);

//         console.log("handleJsonChange", newJsonString, tool.input);
//         try {
//             const parsedJson = JSON.parse(newJsonString);
//             setError(null);
//             if (isEqual(parsedJson, tool.input)) {
//                 mutateInput(undefined);
//             } else {
//                 mutateInput(parsedJson);
//             }
//         } catch (err: any) {
//             setError("Invalid JSON: " + err.message);
//             mutateInput(undefined);
//         }
//     };

//     // Check if this is an MCP tool that can be enhanced
//     const isMcpTool = (toolType: string): boolean => {
//         return (
//             toolType.startsWith("tool-pkgAgent") ||
//             toolType.startsWith("tool-microAgent")
//         );
//     };

//     const shouldShowEnhancedUI = isMcpTool(tool.type) && toolMetadata?.jsonSchema;
//     const _shouldShowReviewAction = shouldShowEnhancedUI && shouldShowReviewAction(tool);

//     return (
//         <div className="flex flex-col gap-2 p-4 rounded-xl">
//             <h4 className="text-lg font-bold">
//                 {toolMetadata?.summary || toolMetadata?.name}
//             </h4>
//             <div
//                 className={`text-sm text-gray-500 ${expanded ? "line-clamp-none" : "line-clamp-2"
//                     }`}
//             >
//                 {toolMetadata?.description}
//             </div>
//             {toolMetadata?.description?.length > 100 && (
//                 <button
//                     onClick={() => setExpanded(!expanded)}
//                     className="text-sm -mt-2 text-gray-400 hover:underline self-start"
//                 >
//                     {expanded ? "Read less" : "Read more"}
//                 </button>
//             )}
//             {Object.keys(tool.input)?.length > 0 &&
//                 (showJson ? (
//                     <div className="relative max-w-[380px] self-stretch">
//                         <Textarea
//                             value={jsonString}
//                             onChange={handleJsonChange}
//                             className={cn(
//                                 "font-mono bg-gray-100 p-2 max-w-full w-full max-h-[200px] overflow-y-auto rounded-xl text-xs whitespace-pre-wrap",
//                                 error && "border-red-500"
//                             )}
//                             rows={10}
//                         />
//                         {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
//                         <Button
//                             variant="ghost"
//                             size="icon"
//                             className="absolute top-1 right-1 h-6 w-6 rounded-full"
//                             onClick={() => setShowJson(false)}
//                         >
//                             <XIcon className="w-3 h-3" />
//                         </Button>
//                     </div>
//                 ) : shouldShowEnhancedUI ? (
//                     <McpRegistry
//                         tool={tool}
//                         input={tool.input}
//                         metadata={toolMetadata}
//                         placement="in-accept-box"
//                     />
//                 ) : (
//                     <div></div>
//                 ))}
//             <div className="flex gap-2 pt-2 justify-end items-stretch">
//                 {!showJson && (
//                     <Button
//                         variant="ghost"
//                         size="sm"
//                         onClick={() => {
//                             setShowJson(true);
//                             setTimeout(() => {
//                                 scrollToBottom();
//                             }, 50);
//                         }}
//                         className="flex-1 h-full bg-neutral-100 hover:bg-neutral-200"
//                     >
//                         Raw parameters
//                     </Button>
//                 )}
//                 {_shouldShowReviewAction && (
//                     <motion.div className="rounded-md p-[3px]">
//                         <Button
//                             variant="ghost"
//                             className="bg-black hover:bg-black/70 hover:text-white px-4 text-white p-0"
//                             onClick={() => {
//                                 setRightPanelContent(
//                                     <div className="relative bg-[#4A154B] text-white flex p-4 h-full flex-col justify-start items-stretch overflow-y-auto">
//                                         <div className="flex flex-row justify-between items-center">
//                                             <div className="flex flex-row gap-2">
//                                                 <img src={agentInfo?.iconUrl} alt="tool icon" className="w-6 h-6" />
//                                                 <p className="text-sm font-bold">{agentInfo?.title ?? mcpName}</p>
//                                             </div>
//                                             <Button variant="ghost" size="icon" onClick={() => {
//                                                 setRightPanelContent(null);
//                                                 handleRightCollapse(true);
//                                             }}>
//                                                 <XIcon className="w-3 h-3" />
//                                             </Button>
//                                         </div>
//                                         <h4 className="text-lg font-bold mt-3 mb-6">
//                                             {toolMetadata?.summary || toolMetadata?.name}
//                                         </h4>
//                                         <McpRegistry
//                                             tool={tool}
//                                             input={tool.input}
//                                             metadata={toolMetadata}
//                                             placement="sidebar"
//                                         />
//                                         <div className="h-[50vh] min-h-[200px]"></div>
//                                         <div className="absolute bottom-0 bg-[#4A154B] right-2 p-4 flex gap-2 pt-2 justify-end items-center">
//                                             <p className="text-sm opacity-50">
//                                                 Click yes to approve the above action.
//                                             </p>
//                                             <YesNoButtons
//                                                 toolCallId={tool.toolCallId}
//                                                 error={error}
//                                                 onYes={() => {
//                                                     handleRightCollapse(true);
//                                                     setRightPanelContent(null);
//                                                 }}
//                                                 onNo={() => {
//                                                     handleRightCollapse(true);
//                                                     setRightPanelContent(null);
//                                                 }}
//                                             />
//                                         </div>
//                                     </div>)
//                                 handleRightCollapse(false);
//                             }}
//                             disabled={!!error}
//                         >
//                             <span className="text-sm">Review</span>
//                             <ChevronRightIcon className="w-3 h-3" />
//                         </Button>
//                     </motion.div>
//                 )}
//                 {!_shouldShowReviewAction && <YesNoButtons toolCallId={tool.toolCallId} error={error} />}
//             </div>
//         </div>
//     );
// };
