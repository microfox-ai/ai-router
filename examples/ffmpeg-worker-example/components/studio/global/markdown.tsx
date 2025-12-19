import dynamic from 'next/dynamic';
import { FC } from 'react';

const TiptapMarkdown = dynamic(() => import('./tiptap-markdown'), {
  ssr: false,
});

const markdownRegex =
  /(^#+\s|\*\*|__|\*|_|~~|`|\[.+\]\(.+\)|!\[.+\]\(.+\)|`{3}|(^>\s)|(^\s*[-\*]\s)|(^\s*\d+\.\s))/m;

const isMarkdown = (text: string) => {
  return markdownRegex.test(text);
};

const htmlRegex = /<[a-z][\s\S]*>/i;
const isHtml = (text: string) => {
  return htmlRegex.test(text);
};

export const InternalMarkdown: FC<{ children: string; className?: string }> = ({
  children,
  className,
}) => {
  if (isMarkdown(children) || isHtml(children)) {
    return <TiptapMarkdown className={className}>{children}</TiptapMarkdown>;
  }
  return <>{children}</>;
};
