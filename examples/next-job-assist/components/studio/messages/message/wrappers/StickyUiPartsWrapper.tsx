import { ToolUIPart } from "ai";

export const StickyUiPartsWrapper = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="mt-2 flex flex-col gap-2">
            {children}
        </div>
    )
}