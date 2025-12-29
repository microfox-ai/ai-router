import React from 'react';
import { UiCommonTypes, DataTableCell, HoverCard as HoverCardType, DataTableRow, DataTable, MixedCell, CellText, CellAvatar, CellLink, CellBadge, CellButton, CellImage } from "@microfox/types";
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import Link from 'next/link';
import { ExternalLinkIcon } from 'lucide-react';
import { decodeHtmlEntities } from '@/lib/studio/html/decode';
import { InternalMarkdown } from '@/components/studio/global/markdown';

const InfoHoverCardContent = ({ data }: { data: HoverCardType }) => {
    const { title, description, url, thumbnail, meta_url } = data as any;

    // Sanitize the description by removing Reddit's specific HTML comments and decoding entities
    const sanitizedDescription = description ? decodeHtmlEntities(
        description.replace(/<!-- SC_OFF -->/g, '')
            .replace(/<!-- SC_ON -->/g, '')
            .replace(/^<div class="md">/, '')
            .replace(/<\/div>$/, '')
            .trim()
    ) : '';

    return (
        <div className="flex flex-col gap-2 p-1">
            <div className="flex items-center gap-2">
                {meta_url?.favicon && (
                    <img
                        src={meta_url.favicon}
                        alt={title}
                        className="w-5 h-5 rounded-full"
                    />
                )}
                {url ? (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-lg line-clamp-2 hover:underline"
                    >
                        {title}
                    </a>
                ) : (
                    <span className="font-semibold text-lg line-clamp-2">{title}</span>
                )}
            </div>

            {(thumbnail?.src || thumbnail?.originalSrc) && (
                <div className="w-full aspect-video rounded-lg overflow-hidden">
                    <img
                        src={thumbnail.originalSrc ?? thumbnail.src}
                        alt={title}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {sanitizedDescription && (
                <div className="text-md text-neutral-600 space-y-4 gap-4">
                    <InternalMarkdown>{sanitizedDescription}</InternalMarkdown>
                </div>
            )}

            {url && (
                <Link
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-start gap-1 pt-3 border-t border-neutral-200 mt-1 hover:underline"
                >
                    <span className="text-xs text-neutral-500">
                        {new URL(url).hostname}
                    </span>
                    <ExternalLinkIcon className="w-3 h-3" />
                </Link>
            )}
        </div>
    );
};

const renderCell = (cell: DataTableCell): React.ReactNode => {
    const renderCellContent = (cell: DataTableCell): React.ReactNode => {
        if (typeof cell === "string") {
            return <span>{cell}</span>;
        }

        if (!cell || !cell.type) {
            return null;
        }

        switch (cell.type) {
            case "text": {
                const c = cell as CellText;
                return <span className={cn("text-sm", c.className)} style={{}}>{c.value}</span>;
            }
            case "link": {
                const c = cell as CellLink;
                return (
                    <a
                        href={c.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("text-blue-500 hover:underline flex items-center gap-2", c.className)}
                        style={c.style ?? {}}
                    >
                        {c.items && c.items.length > 0
                            ? c.items.map((child, i) => <React.Fragment key={i}>{renderCell(child)}</React.Fragment>)
                            : c.text
                        }
                    </a>
                );
            }
            case "avatar": {
                const c = cell as CellAvatar;
                return (
                    <div className={cn('flex items-center', c.bgClassName)}>
                        {c.img?.src && <img
                            src={c.img?.src}
                            alt={c.img?.title || ''}
                            className={cn("h-8 w-8 rounded-full object-cover", c.imgClassName)}
                        />}
                        {!c.img?.src && <div className={cn("h-8 w-8 rounded-full bg-gray-800 flex items-center justify-center", c.imgClassName)}>
                            <span className={cn("text-xs font-medium text-gray-100")}>{c.img?.title?.charAt(0).toUpperCase()}</span>
                        </div>}
                    </div>
                );
            }
            case "badge": {
                const c = cell as CellBadge;
                return (
                    <Badge
                        variant={c.variant}
                        className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800", c.className)}>
                        {c.label}
                    </Badge>
                );
            }
            case "button": {
                const c = cell as CellButton;
                return (
                    <Button
                        variant={c.variant}
                        type="button" className={cn("px-3 py-1.5 text-sm font-semibold rounded-md shadow-sm bg-white text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50", c.className)}>
                        {c.items?.map((item, i) => <React.Fragment key={i}>{renderCell(item)}</React.Fragment>)}
                    </Button>
                );
            }
            case "mixed": {
                const c = cell as MixedCell;
                return (
                    <div className={cn("flex items-center gap-1", c.className)}>
                        {c.items?.map((child, i) => <React.Fragment key={i}>{renderCell(child)}</React.Fragment>)}
                    </div>
                )
            }
            default:
                return null;
        }
    }

    if (typeof cell === 'object' && cell !== null && (cell as any).hoverCard) {
        const hoverCardData = (cell as any).hoverCard as HoverCardType;
        return (
            <HoverCard openDelay={200}>
                <HoverCardTrigger asChild>
                    <span className="cursor-pointer">{renderCellContent(cell)}</span>
                </HoverCardTrigger>
                <HoverCardContent className="w-[600px] max-h-[50vh] overflow-y-auto z-50">
                    <InfoHoverCardContent data={hoverCardData} />
                </HoverCardContent>
            </HoverCard>
        );
    }
    return renderCellContent(cell);
};

export const InfoTable = ({ data }: { data: UiCommonTypes["DataTable"] }) => {
    const { caption, title, description, rows } = data;
    console.log("ragreddit", data);
    return (
        <div className={cn("flex flex-col gap-2 ")}>
            {title && <h1 className={cn("font-semibold text-lg")}>{title}</h1>}
            {description && <p className={cn("text-sm text-gray-500")}>{description}</p>}
            <div className="overflow-x-auto my-4 border rounded-lg border-gray-200">
                <table className={cn("w-full border-collapse")}>
                    {rows && rows.length > 0 && (
                        <tbody className={cn("divide-y divide-gray-200")}>
                            {rows.map((row, rowIndex) => (
                                <tr key={rowIndex} className={cn("flex flex-row gap-2 divide-x divide-gray-200", row.className)}>
                                    {row.items?.map((cell, cellIndex) => (
                                        <td key={cellIndex} className={cn("flex-1 py-2 px-1", cell.className)}>
                                            {renderCell(cell.cell)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    )}
                </table>
            </div>
        </div>
    )
};