import { FC, ReactNode, useRef, useEffect, useState } from 'react';
import { InternalMarkdown } from './markdown';

interface MessageThoughtWrapperProps {
    children: string;
    isStreaming?: boolean;
}

export const MessageMarkdown: FC<MessageThoughtWrapperProps> = ({ children, isStreaming = false }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const isThought = children?.trim()?.toLowerCase()?.startsWith('thought:');

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [children]);

    useEffect(() => {
        if (!isStreaming && isThought) {
            setIsCollapsed(true);
        }
    }, [isStreaming, isThought]);

    if (isThought) {
        return (
            <div className={`rounded-md p-3 relative ${isStreaming ? '' : ''} ${isCollapsed ? 'max-h-[0px] p-0!' : ''}`}>
                <div className='absolute bottom-0 left-0 right-0 w-full h-[50%] bg-gradient-to-t from-white to-transparent' />
                <div className='absolute top-0 left-0 right-0 w-full h-[50%] bg-gradient-to-b from-white to-transparent' />
                <div
                    ref={scrollRef}
                    className={`overflow-y-auto transition-all duration-300 ${isCollapsed ? 'max-h-[0px]' : 'max-h-[150px]'}`}
                    onClick={() => !isStreaming && setIsCollapsed(!isCollapsed)}
                    style={{ cursor: !isStreaming ? 'pointer' : 'default' }}
                >
                    <InternalMarkdown>{children}</InternalMarkdown>
                </div>
            </div>
        );
    }

    return <InternalMarkdown>{children}</InternalMarkdown>;
};
