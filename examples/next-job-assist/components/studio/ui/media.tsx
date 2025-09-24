"use client";
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogPortal,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogTitle } from "@radix-ui/react-dialog";
import { Expand, ExternalLink, Film, User, View, XIcon, ClipboardIcon, Copy, Search, Palette } from "lucide-react";
import { UiCommonTypes } from "@microfox/types";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";


export type MediaDialogItem = {
    type: "image";
    image: UiCommonTypes["ImageSet"];
    video?: never;
} | {
    type: "video";
    video: UiCommonTypes["VideoSet"];
    image?: never;
}

const VideoEmbed = ({ video }: { video: UiCommonTypes["VideoSet"] }) => {
    const getEmbedUrl = (url: string) => {
        if (url.includes("youtube.com/watch?v=")) {
            const videoId = url.split("v=")[1]?.split("&")[0];
            return `https://www.youtube.com/embed/${videoId}`;
        } else if (url.includes("youtu.be/")) {
            const videoId = url.split("youtu.be/")[1]?.split("?")[0];
            return `https://www.youtube.com/embed/${videoId}`;
        } else if (url.includes("dailymotion.com/video/")) {
            const videoId = url.split("/video/")[1]?.split("?")[0];
            return `https://www.dailymotion.com/embed/video/${videoId}`;
        }
        return url;
    };

    const embedUrl = getEmbedUrl(video.src);

    if (!embedUrl) {
        return <div className="w-full aspect-video bg-black flex items-center justify-center text-white">Cannot play this video format.</div>;
    }

    return (
        <iframe
            src={embedUrl}
            className="w-full aspect-video rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={video.creator || "Video"}
        ></iframe>
    );
};



export const MediaDialog = ({
    media,
    setMedia
}: {
    media: MediaDialogItem | null;
    setMedia: (media: MediaDialogItem | null) => void;
}) => {
    const item = media ? (media.type === 'image' ? media.image : media.video) : null;
    const [showFullDescription, setShowFullDescription] = useState(false);
    const [showFullKeywords, setShowFullKeywords] = useState(false);

    return (
        <Dialog open={!!media} onOpenChange={(open) => !open && setMedia(null)}>
            <DialogPortal>
                <DialogOverlay

                    className="fixed z-100 inset-0 bg-black/50 backdrop-blur-xl" />
                <DialogContent
                    onClick={(e) => {
                        setMedia(null);
                    }}
                    className="w-screen max-w-screen! h-screen z-101 bg-transparent border-none shadow-none grid grid-cols-3 items-center gap-4 overflow-y-auto">
                    <div className="col-span-1  flex flex-col gap-4 justify-start h-full">
                        {media?.type === 'image' && 'image' in media && media.image?.metadata && (
                            <div
                                className="bg-neutral-900 rounded-xl p-4 text-white shadow-lg"
                            >
                                <h3 className="px-2 pb-4 text-md text-neutral-300 mb-3 flex items-center gap-4">
                                    <Palette className="w-4 h-4 text-neutral-400" />
                                    Color Palette
                                </h3>
                                <div className="grid grid-cols-12 gap-3">
                                    {media.image.metadata.dominantColor && typeof media.image.metadata.dominantColor === 'string' && (
                                        <div className="col-span-4 flex flex-col gap-1">
                                            <span className="text-xs text-neutral-400">Dominant Color</span>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div
                                                            className="w-full h-8 rounded-md cursor-pointer"
                                                            style={{ backgroundColor: media.image.metadata.dominantColor }}
                                                            onClick={() => {
                                                                if (media.image?.metadata?.dominantColor) {
                                                                    navigator.clipboard.writeText(media.image.metadata.dominantColor);
                                                                }
                                                            }}
                                                        />
                                                    </TooltipTrigger>
                                                    <TooltipContent className="z-[200]">
                                                        <p>Copy {media.image.metadata.dominantColor}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    )}
                                    {media.image.metadata.secondaryColor && typeof media.image.metadata.secondaryColor === 'string' && (
                                        <div className="col-span-4 flex flex-col gap-1">
                                            <span className="text-xs text-neutral-400">Secondary Color</span>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div
                                                            className="w-full h-8 rounded-md cursor-pointer"
                                                            style={{ backgroundColor: media.image.metadata.secondaryColor }}
                                                            onClick={() => {
                                                                if (media.image?.metadata?.secondaryColor) {
                                                                    navigator.clipboard.writeText(media.image.metadata.secondaryColor);
                                                                }
                                                            }}
                                                        />
                                                    </TooltipTrigger>
                                                    <TooltipContent className="z-[200]">
                                                        <p>Copy {media.image.metadata.secondaryColor}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    )}
                                    {media.image.metadata.accentColor && typeof media.image.metadata.accentColor === 'string' && (
                                        <div className="col-span-4 flex flex-col gap-1">
                                            <span className="text-xs text-neutral-400">Accent Color</span>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div
                                                            className="w-full h-8 rounded-md cursor-pointer"
                                                            style={{ backgroundColor: media.image.metadata.accentColor }}
                                                            onClick={() => {
                                                                if (media.image?.metadata?.accentColor) {
                                                                    navigator.clipboard.writeText(media.image.metadata.accentColor);
                                                                }
                                                            }}
                                                        />
                                                    </TooltipTrigger>
                                                    <TooltipContent className="z-[200]">
                                                        <p>Copy {media.image.metadata.accentColor}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    )}
                                    {media.image.metadata.palette && Array.isArray(media.image.metadata.palette) && (
                                        <div className="col-span-12 flex flex-col gap-1">
                                            <span className="text-xs text-neutral-400">Color Palette</span>
                                            <div className="grid grid-cols-6 gap-1">
                                                {media.image.metadata.palette.map((color, index) => (
                                                    <TooltipProvider key={color + index}>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div
                                                                    className="h-6 rounded-md cursor-pointer"
                                                                    style={{ backgroundColor: color }}
                                                                    onClick={() => {
                                                                        if (typeof color === 'string') {
                                                                            navigator.clipboard.writeText(color);
                                                                        }
                                                                    }}
                                                                />
                                                            </TooltipTrigger>
                                                            <TooltipContent className="z-[200]">
                                                                <p>Copy {color}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {media?.type === 'image' && 'image' in media && media.image?.metadata && (media.image.metadata.audienceKeywords || media.image.metadata.artStyle || media.image.metadata.keywords) &&
                            <div
                                onClick={(e) => e.stopPropagation()}
                                className="bg-neutral-900 rounded-xl py-4 text-white shadow-lg">

                                <h2 className="px-8 text-md text-neutral-300 mb-3 flex items-center gap-4">
                                    <Search className="w-4 h-4 text-neutral-400" />
                                    Search Finetuning
                                </h2>

                                <div className="w-full h-[0.5px] bg-neutral-700 my-4" />

                                <div className="px-8">
                                    {media.image.metadata.artStyle && media.image.metadata.artStyle.length > 0 && (
                                        <div className="mb-8">
                                            <h3 className="text-xs uppercase tracking-[0.5em] text-neutral-300 mb-2">Art Style</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {media.image.metadata.artStyle?.map((word) => (
                                                    <Badge
                                                        key={word}
                                                        variant="outline"
                                                        className="cursor-pointer bg-white/10 hover:bg-white/20 text-white border-none"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const url = new URL(window.location.href);
                                                            url.searchParams.set('artStyle', word);
                                                            window.open(url.toString(), '_blank');
                                                        }}
                                                    >
                                                        @{word}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {media.image.metadata.audienceKeywords && media.image.metadata.audienceKeywords.length > 0 && (
                                        <div className="mb-8">
                                            <h3 className="text-xs uppercase tracking-[0.5em] text-neutral-300 mb-2">Suite to</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {media.image.metadata.audienceKeywords.map((word) => (
                                                    <Badge
                                                        key={word}
                                                        variant="outline"
                                                        className="cursor-pointer bg-white/10 hover:bg-white/20 text-white border-none"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const url = new URL(window.location.href);
                                                            url.searchParams.set('audienceKeyword', word);
                                                            window.open(url.toString(), '_blank');
                                                        }}
                                                    >
                                                        !{word}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {media.image.metadata.keywords && (
                                        <div>
                                            <div className={`relative overflow-hidden transition-all duration-300 ${showFullKeywords ? 'max-h-full' : 'max-h-[160px]'}`}>
                                                <h3 className="text-xs uppercase tracking-[0.5em] text-neutral-300 mb-2">Keywords</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {media.image.metadata.keywords.map((word) => (
                                                        <Badge
                                                            key={word}
                                                            variant="outline"
                                                            className="cursor-pointer bg-white/10 hover:bg-white/20 text-white border-none"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const url = new URL(window.location.href);
                                                                url.searchParams.set('keyword', word);
                                                                window.open(url.toString(), '_blank');
                                                            }}
                                                        >
                                                            #{word}
                                                        </Badge>
                                                    ))}
                                                </div>
                                                {!showFullKeywords && (
                                                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-neutral-900 to-transparent" />
                                                )}
                                            </div>
                                            <div className="mt-4 flex items-center justify-between">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowFullKeywords(!showFullKeywords);
                                                    }}
                                                    className="text-xs text-neutral-400 hover:text-white bg-transparent hover:bg-transparent"
                                                >
                                                    {showFullKeywords ? 'Show Less' : 'Show More'}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        }
                    </div>
                    <div className="col-span-1 ">
                        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4 max-w-xl">
                            <DialogTitle title="Expanded view" hidden />
                            <div className="flex-1">
                                {media?.type === 'image' &&
                                    <img src={media.image.originalSrc ?? media.image.src} alt={media.image.title ?? "Expanded view"} className="w-auto h-auto object-contain rounded-2xl mx-auto" />
                                }
                                {media?.type === 'video' &&
                                    <VideoEmbed video={media.video} />
                                }
                            </div>
                            {item && media?.type === 'video' && <div className=" w-full bg-neutral-900/80 p-4 rounded-xl text-white flex flex-col gap-2">
                                {/* <h3 className="font-bold text-lg">{media?.video?.title}</h3> */}
                                <div className="text-xs text-neutral-400 flex flex-row gap-2 mt-auto">
                                    {media?.type === 'video' && media.video.creator && <div className="flex items-center gap-2"><User size={12} /><span>{media.video.creator}</span></div>}
                                    {media?.type === 'video' && media.video.views && <div className="flex items-center gap-2"><View size={12} /><span>{media.video.views.toLocaleString()} views</span></div>}
                                    {media?.type === 'video' && media.video.duration && <div className="flex items-center gap-2"><Film size={12} /><span>{media.video.duration}</span></div>}
                                    <a href={media.video?.src} target="_blank" rel="noopener noreferrer" className="bg-white/80 text-black ml-auto hover:bg-white p-2 rounded-full transition-colors flex flex-row gap-2" title="View Source" onClick={(e) => e.stopPropagation()}>
                                        <ExternalLink className="w-4 h-4 text-neutral-800" />
                                        View Source
                                    </a>
                                </div>
                            </div>}
                            {item && media?.type === "image" && <div className=" w-full bg-neutral-900/80 p-2 rounded-3xl text-white flex flex-col gap-2">
                                <div className="px-2 py-2 text-xs text-neutral-400 flex flex-row items-center gap-2 mt-auto">
                                    <p className="font-bold text-white text-sm">{media?.image?.title}</p>
                                    <a href={media.image?.src} target="_blank" rel="noopener noreferrer" className="bg-white/50 text-black ml-auto hover:bg-white p-2 rounded-full transition-colors flex flex-row gap-2" title="View Source" onClick={(e) => e.stopPropagation()}>
                                        <ExternalLink className="w-4 h-4 text-neutral-800" />
                                        Source
                                    </a>
                                </div>
                            </div>}
                            <DialogClose className="bg-black/50 rounded-full p-2 absolute top-4 right-4">
                                <XIcon className="w-4 h-4 text-white" />
                            </DialogClose>
                        </div>
                    </div>
                    <div className="col-span-1 flex flex-col gap-4 justify-start h-full">
                        {media?.image && media?.image?.metadata &&
                            <div
                                onClick={(e) => e.stopPropagation()}
                                className="bg-neutral-900 rounded-xl p-4 text-white shadow-lg max-w-md">
                                <div className={`relative overflow-hidden transition-all duration-300 ${showFullDescription ? 'max-h-full' : 'max-h-[160px]'}`}>
                                    <h3 className="text-md text-neutral-300 mb-2 font-bold">Image Prompt</h3>
                                    <p className="text-sm text-neutral-300 leading-relaxed">
                                        {media?.image?.description
                                        }

                                    </p>
                                    {!showFullDescription && (
                                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-neutral-900 to-transparent" />
                                    )}
                                </div>
                                <div className="mt-4 flex items-center justify-between">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowFullDescription(!showFullDescription);
                                        }}
                                        className="text-xs text-neutral-400 hover:text-white bg-transparent hover:bg-transparent"
                                    >
                                        {showFullDescription ? 'Show Less' : 'Read More'}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const description = media?.type === 'image'
                                                ? media.image.description || 'No image description available'
                                                : 'No description available';
                                            navigator.clipboard.writeText(description);
                                        }}
                                        className="bg-neutral-800 hover:bg-transparent hover:text-white text-xs"
                                        title="Copy description"
                                        style={{
                                            backgroundColor: media?.image?.metadata?.dominantColor ? `${media.image.metadata.dominantColor}` : undefined,
                                            color: media?.image?.metadata?.accentColor ? `${media.image.metadata.accentColor}` : "#ffffff",
                                        }}
                                    >
                                        <span className="">Copy Prompt</span>
                                        <Copy
                                            style={{
                                                color: media?.image?.metadata?.accentColor ? `${media.image.metadata.accentColor}` : undefined,
                                            }}
                                            className="w-4 h-4 text-white" />
                                    </Button>
                                </div>
                            </div>
                        }

                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    )
}

export const MediaGrid = ({ images }: { images: UiCommonTypes["ImageSet"][] }) => {
    const [selectedMedia, setSelectedMedia] = useState<MediaDialogItem | null>(null);

    if (!images || images.length === 0) {
        return null;
    }

    let filteredImages = images.filter((image) => image.srcWidth ? image.srcWidth > 50 : true);
    return (
        <>
            <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-2 md:gap-4">
                {filteredImages.map((source, idx) => (
                    <div
                        onClick={() => setSelectedMedia({ type: "image", image: source })}
                        key={source.src + idx}
                        className="relative group/media bg-neutral-900 rounded-lg overflow-hidden cursor-pointer break-inside-avoid mb-4"
                    >
                        <img key={source.src} src={source.src ?? ""} alt={source.title ?? ""} className="w-full h-auto transition-transform duration-300 group-hover/media:scale-110" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/media:opacity-100 transition-opacity duration-300 flex items-end justify-end p-3">
                            <div className="flex items-center gap-2 transform scale-75 group-hover/media:scale-100 transition-transform duration-300">
                                <a href={source.imagePageUrl ?? source.pageUrl ?? source.url ?? undefined} target="_blank" rel="noopener noreferrer" className="bg-white/80 hover:bg-white p-2 rounded-full transition-colors" title="View Source" onClick={(e) => e.stopPropagation()}>
                                    <ExternalLink className="w-4 h-4 text-neutral-800" />
                                </a>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedMedia({ type: "image", image: source });
                                    }}
                                    className="bg-white/80 hover:bg-white p-2 rounded-full transition-colors" title="Expand Image"
                                >
                                    <Expand className="w-4 h-4 text-neutral-800" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <MediaDialog media={selectedMedia} setMedia={setSelectedMedia} />
        </>
    );
}; 