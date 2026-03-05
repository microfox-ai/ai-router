'use client';

import { MediaDialog, MediaDialogItem } from "@/components/studio/ui/media";
import { WebSearchOutput, WebSearchSource } from "../types";
import { InternalMarkdown } from "@/components/studio/global/markdown";
import Link from "next/link";
import { Expand, ExternalLink, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { mapBraveWebSearch } from "../mapper";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { AiRouterTools } from "@/app/ai";
import { ToolUIPart } from "ai";
import { useMessageParts } from "@/components/studio/context/MessageProvider";


export const HoverSourcePopup = ({ source }: { source: WebSearchSource }) => {
    return (
        <div className="flex flex-col gap-2 p-1">
            <div className="flex items-center gap-2">
                <img
                    src={source.meta_url?.favicon ?? ""}
                    alt={source.title}
                    className="w-5 h-5 rounded-full"
                />
                <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sm line-clamp-1 hover:underline"
                >
                    {source.title}
                </a>
            </div>

            {(source.thumbnail?.src || source.thumbnail?.originalSrc) && (
                <div className="w-full aspect-video rounded-lg overflow-hidden">
                    <img
                        src={source.thumbnail.originalSrc ?? source.thumbnail.src}
                        alt={source.title}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {source.description && (
                <p className="text-sm text-neutral-600 line-clamp-3">
                    <InternalMarkdown>{source.description}</InternalMarkdown>
                </p>
            )}

            <Link href={source.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-start gap-1 pt-3 border-t border-neutral-200 mt-1 hover:underline">
                <span className="text-xs text-neutral-500">
                    {new URL(source.url).hostname}
                </span>
                <ExternalLinkIcon className="w-3 h-3" />
            </Link>
        </div>
    )
}

export const BraveSourceHeader = ({
    tool,
    isStickyRender
}: {
    tool: ToolUIPart<Pick<AiRouterTools, "braveResearchFast" | "braveResearchDeep">>
    isStickyRender?: boolean
}) => {
    const [selectedMedia, setSelectedMedia] = useState<MediaDialogItem | null>(null);
    if (!tool.output) {
        return null;
    }
    const { stickyUiParts, activePart, displayParts } = useMessageParts();

    // only stick this if the active part is text part
    const activePartIsText = activePart > 0 && displayParts[activePart - 1].type === "text";
    // if this is sticky render, only render if the active part is not text
    if (!activePartIsText && isStickyRender) {
        return null;
    }

    const data = mapBraveWebSearch(tool.output);

    let sources = [...(data?.image_sources ?? []), ...(data?.video_sources ?? [])];
    sources = sources.filter((srx) => srx.thumbnail?.src);
    if (sources.length > 0) {
        return (<>
            <div className="flex gap-2 overflow-x-auto">
                {sources.map((source, idx) => (
                    <div
                        onClick={() => {
                            if (source.media_type === 'video') {
                                setSelectedMedia({
                                    type: 'video', video: {
                                        src: source.url,
                                        ...source.meta_media
                                    }
                                });
                            } else {
                                setSelectedMedia({
                                    type: 'image', image: {
                                        src: source.thumbnail?.src ?? "",
                                        originalSrc: source.thumbnail?.originalSrc,
                                        title: source.title,
                                        url: source.url,
                                        description: source.description,
                                    }
                                });
                            }
                        }}
                        key={source.url + idx} className="relative group/media bg-neutral-900 rounded-lg overflow-hidden flex-shrink-0 min-w-20 h-40 cursor-pointer">
                        <img src={source.thumbnail?.src ?? ""} alt={source.title} className="min-w-20 h-full object-cover transition-transform duration-300 group-hover/media:scale-110" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/media:opacity-100 transition-opacity duration-300 flex items-end justify-end p-2">
                            <div className="flex items-center gap-2 transform scale-75 group-hover/media:scale-100 transition-transform duration-300">

                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    if (source.media_type === 'video') {
                                        setSelectedMedia({
                                            type: 'video', video: {
                                                src: source.url,
                                                ...source.meta_media
                                            }
                                        });
                                    } else {
                                        setSelectedMedia({
                                            type: 'image', image: {
                                                src: source.thumbnail?.src ?? "",
                                                originalSrc: source.thumbnail?.originalSrc,
                                                title: source.title,
                                                url: source.url,
                                                description: source.description,
                                            }
                                        });
                                    }
                                }
                                } className="bg-white/80 hover:bg-white p-2 rounded-full transition-colors" title="Expand Image">
                                    <Expand className="w-4 h-4 text-neutral-800" />
                                </button>
                                <HoverCard openDelay={700} key={source.url + idx}>
                                    <HoverCardTrigger asChild>
                                        <a href={source.url}
                                            onClick={(e) => e.stopPropagation()}
                                            target="_blank" rel="noopener noreferrer" className="bg-white/80 hover:bg-white p-2 rounded-full transition-colors" title="View Source">
                                            <ExternalLink className="w-4 h-4 text-neutral-800" />
                                        </a>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="w-80">
                                        <HoverSourcePopup source={source} />
                                    </HoverCardContent>
                                </HoverCard>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <MediaDialog media={selectedMedia} setMedia={setSelectedMedia} />
        </>);
    }

    return null;
}
