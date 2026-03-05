import { InternalMarkdown } from "./markdown";


export const PrintCode = ({ code }: { code: string }) => {
    return (
        <InternalMarkdown>
            {code}
        </InternalMarkdown>
    );
};