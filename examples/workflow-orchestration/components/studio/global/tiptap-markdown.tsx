import { FC, useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { processTimeSince } from './remarkTimeSince';
import '@/components/studio/tiptap.css';

interface TiptapMarkdownProps {
    children: string;
    className?: string;
}

const TiptapMarkdown: FC<TiptapMarkdownProps> = ({
    children,
    className,
}) => {
    const [htmlContent, setHtmlContent] = useState('');

    useEffect(() => {
        const processMarkdown = async () => {
            const processedContent = processTimeSince(children);

            const result = await unified()
                .use(remarkParse)
                .use(remarkGfm)
                .use(remarkRehype, { allowDangerousHtml: true })
                .use(rehypeRaw)
                .use(rehypeStringify)
                .process(processedContent);

            setHtmlContent(String(result));
        };

        processMarkdown();
    }, [children]);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3, 4, 5, 6],
                },
                paragraph: {
                },
                bulletList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
                orderedList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
            }),
            Link.configure({
                openOnClick: true,
                HTMLAttributes: {
                    class: 'text-blue-500 hover:text-blue-600 underline',
                },
            }),
            CodeBlock.configure({
                HTMLAttributes: {
                    class: 'bg-zinc-100 dark:bg-zinc-800 rounded-md p-4 my-2 overflow-x-auto',
                },
            }),
            Table.configure({
                resizable: true,
                HTMLAttributes: {
                    class: 'text-xs dark:border-gray-700 rounded-md p-1 px-2 overflow-x-auto rounded-xl my-3',
                },
            }),
            TableRow.configure({
                HTMLAttributes: {
                    class: 'text-xs dark:border-gray-700 rounded-md p-1 px-2 overflow-x-auto rounded-xl',
                },
            }),
            TableHeader.configure({
                HTMLAttributes: {
                    class: 'border border-gray-300 bg-neutral-100 dark:border-gray-700 rounded-md p-1 px-2 overflow-x-auto',
                },
            }),
            TableCell.configure({
                HTMLAttributes: {
                    class: 'border border-gray-300 dark:border-gray-700 rounded-md p-1 overflow-x-auto rounded-xl',
                },
            }),
        ],
        editorProps: {
            attributes: {
                style: 'font-size: 12px',
            },
        },
        content: htmlContent,
        editable: false,
    });

    useEffect(() => {
        if (editor && htmlContent) {
            editor.commands.setContent(htmlContent);
        }
    }, [editor, htmlContent]);

    return (
        <div className={`tiptap-markdown-viewer ${className || ''}`}>
            <EditorContent editor={editor} />
        </div>
    );
};

export default TiptapMarkdown; 