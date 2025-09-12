import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentData, AgentTool } from "@microfox/ai-router";
import { AlignStartHorizontalIcon, ChevronDown, ChevronLeft, ChevronRight, CircleIcon, CommandIcon, NotebookTextIcon, NotepadTextIcon, TypeIcon, TypeOutlineIcon } from "lucide-react";
import { useAppChat } from "../../../context/AppChatProvider";
import { useMessageParts } from "../../../context/MessageProvider";
import { useComponents } from "../../../context/ComponentProvider";
import { DataUIPart } from "ai"
export const StepBanner = () => {
    const { status } = useAppChat();
    const { activePart, setActivePart, displayParts, message, setActivePartByToolCallId } = useMessageParts();

    const lastPartIndex = displayParts ? displayParts.length - 1 : -1;

    const hasPendingHumanIntervention = message?.parts?.some(p => {
        if (p.type?.startsWith("tool-") && (p as any).output) {
            try {
                // p.output can be a stringified JSON
                const output = typeof (p as any).output === 'string' ? JSON.parse((p as any).output) : (p as any).output;
                return output?._humanIntervention === true;
            } catch (error) {
                // Not a valid JSON, so it can't have _humanIntervent
                return false;
            }
        }
        return false;
    });

    const lastPart = displayParts[lastPartIndex];
    const lastPartIsSummary = lastPart?.type.match(/summary/i) || lastPart?.type === "text";
    const hasFinalSummary = lastPartIndex !== -1 && lastPartIsSummary && !hasPendingHumanIntervention && status !== "streaming";
    const isFinalSummaryActive = hasFinalSummary && activePart === lastPartIndex;

    const { aiRouterMetadata } = useComponents();
    const partsWithMetadata = displayParts?.map((p) => {
        if (p.type.startsWith(`tool-`)) {
            const thisToolMetadata = aiRouterMetadata[p.type.replace("tool-", "") as keyof typeof aiRouterMetadata];
            // get the info conforming the metadata for this toolpart.
            return {
                ...p,
                metadata: thisToolMetadata,
            };
        }
        if (p.type.startsWith(`data-`)) {
            // get the info conforming the metadata for this datapart.
            return {
                ...p,
                metadata: ((p as DataUIPart<any>).data as AgentData)?.metadata,
            };
        }
        if (p.type === "text") {
            return {
                ...p,
                metadata: {
                }
            };
        }
        return {
            ...p, metadata: {
            }
        };
    }).filter((p) => p !== null);

    return (
        <div className="flex mb-4 border-b border-neutral-200 gap-1 bg-transparent items-center sticky bg-white z-9 top-[0px] shadow-xs">
            <ChevronLeft
                className={`h-4 w-4 text-gray-500 cursor-pointer ${activePart > 0 ? "opacity-100" : "opacity-50"
                    }`}
                onClick={() => {
                    if (activePart > 0) {
                        setActivePart(activePart - 1)
                    }
                }}
            />
            <div
                className={`text-xs align-items-center p-0 bg-transparent hover:text-black cursor-pointer line-height-[0.5em]`}
            >
                Step {activePart + 1}
            </div>
            <ChevronRight
                className={`h-4 w-4 text-gray-500 cursor-pointer ${activePart < (displayParts?.length ?? 0) - 1
                    ? "opacity-100"
                    : "opacity-50"
                    }`}
                onClick={() => {
                    if (displayParts && activePart < displayParts.length - 1) {
                        setActivePart(activePart + 1)
                    }
                }}
            />
            <div className="flex flex-row items-center gap-2 px-2">
                {partsWithMetadata.map((p, _index) => {
                    //const mcpType = p.mcpType;
                    const isActivePart = (p as any).toolCallId === (displayParts[activePart] as any)?.toolCallId;
                    const isLastPart = _index === partsWithMetadata.length - 1;
                    const icon = p.metadata?.icon;
                    const title = p.metadata?.title;
                    const parentTitle = p.metadata?.parentTitle;
                    const isTextPart = p.type === "text";

                    if (isTextPart) {

                        if (isActivePart) {
                            return null;
                            // return (<span className="text-md font-medium text-neutral-800">{
                            //     p.type === "text" ?
                            //         isFinalSummaryActive ? "Final Summary" : "Text" :
                            //         title
                            // }</span>)
                        }

                        if (_index === partsWithMetadata.length - 1) {
                            return null;
                        }

                        return (
                            <div key={p.type + _index} className="flex items-center gap-2">
                                <NotepadTextIcon className="w-4 h-4" />
                                <span className="text-md font-medium text-neutral-800">Text</span>
                            </div>
                        )
                    }

                    if (isTextPart && isActivePart && isFinalSummaryActive) {
                        return null;
                    }


                    return (
                        <div key={p.type + _index} className="flex items-center gap-2">
                            <div
                                onClick={() => {
                                    setActivePartByToolCallId((p as any).toolCallId);
                                }}
                                className={`flex items-center gap-2 cursor-pointer py-1 ${isActivePart ? "border-b-2 border-black" : ""
                                    }`}
                            >
                                <Tooltip>
                                    <TooltipTrigger>
                                        {icon ?
                                            <img src={icon ?? ""} alt={title} className="w-4 h-4 rounded-full" /> :
                                            <TypeIcon className="w-4 h-4" />
                                        }
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {(title && title.length > 0) ?
                                            `${title} ${parentTitle ? `in ${parentTitle}` : ``}` :
                                            `Toolcall ${parentTitle ? `in ${parentTitle}` : ``}`}
                                    </TooltipContent>
                                </Tooltip>
                                {isActivePart && (
                                    <span className="text-md font-medium text-neutral-800">{
                                        title
                                    }</span>
                                )}
                            </div>
                            <ChevronRight className="w-3 h-3" />
                        </div>
                    )
                })}
                {hasFinalSummary && (
                    <>
                        <div
                            onClick={() => {
                                if (displayParts) {
                                    setActivePart(displayParts.length - 1);
                                }
                            }}
                            className="flex items-center gap-2 cursor-pointer"
                        >
                            <span
                                className={`text-md py-1 ${isFinalSummaryActive
                                    ? "text-neutral-800 border-b-2 border-black font-medium"
                                    : "text-neutral-500"
                                    }`}
                            >
                                {isFinalSummaryActive ? "Final Summary" : "Summary"}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}