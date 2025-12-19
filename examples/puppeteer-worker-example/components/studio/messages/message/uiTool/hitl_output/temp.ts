import { prettySinceTime } from '@/lib/studio/helpers/prettyprint';
import {
  CellAvatar,
  CellLink,
  CellText,
  DataTableRow,
  DataTableCell,
  UiCommonTypes,
} from '@microfox/types';

export const TempMapper = (
  data: {
    avatar: string;
    color: string;
    commentCount: number;
    createdAt: number;
    lastIndexedAt: number;
    updatedAt: number;
    subreddit: string;
    title: string;
    url: string;
    username: string;
    description: string;
    relevance_score: number;
    id: string;
    subredditId: string;
    name: string;
  }[],
): UiCommonTypes['DataTable'] => {
  return {
    title: 'Subreddits',
    description: 'Subreddits that are relevant to the query',
    rows: data.map((item) => {
      return {
        className: 'px-2 py-1',
        items: [
          {
            className: 'flex-1',
            cell: {
              type: 'mixed',
              className: 'flex flex-col items-start gap-2',
              items: [
                {
                  type: 'link',
                  href: 'https://www.reddit.com' + item.url,
                  text: 'r/' + item.id,
                  style: {
                    borderColor: item.color,
                  },
                  className: `flex items-center gap-2 bg-neutral-100 rounded-3xl px-2 py-1 hover:bg-neutral-200 hover:no-underline`,
                  items: [
                    {
                      type: 'avatar',
                      img: {
                        src: item.avatar,
                        title: item.id,
                      },
                      imgClassName: 'h-6 w-6 rounded-full',
                    } as CellAvatar,
                    {
                      type: 'text',
                      value: 'r/' + item.id,
                      style: {
                        color: item.color,
                      },
                      className: 'text-xs font-medium text-black',
                    } as CellText,
                  ],
                },
                {
                  type: 'text',
                  value: `Score: ${item.relevance_score.toFixed(2)}`,
                  className:
                    'text-xs uppercase font-medium text-gray-500 tracking-[0.1em]',
                } as CellText,
              ],
            },
          },
          // column 2. description
          {
            className: 'flex-2',
            cell: {
              type: 'text',
              value: item.description,
              className: 'text-sm font-medium line-clamp-2',
            } as CellText,
          },
        ],
      } as DataTableRow;
    }),
  };
};

export const PostMapper = (
  data: {
    data: string;
    id: string;
    metadata: {
      author: string;
      created_utc: number;
      downs: number;
      permalink: string;
      score: number;
      selftext_html: string;
      ups: number;
      subreddit: string;
      title: string;
      url: string;
      upvote_ratio: number;
      num_comments: number;
    };
  }[],
): UiCommonTypes['DataTable'] => {
  return {
    title: 'Reddit Posts',
    description: 'Relevant posts found on Reddit.',
    rows: data.map((post) => {
      const { metadata } = post;
      return {
        className: 'px-2 py-2 border-b border-neutral-200',
        items: [
          // Column 1: Title, subreddit, author, date
          {
            className: 'flex-3 pr-4',
            cell: {
              type: 'mixed',
              className: 'flex flex-col items-start gap-1',
              items: [
                {
                  type: 'text',
                  value: prettySinceTime(
                    new Date(metadata.created_utc * 1000).toISOString(),
                  ),
                  className: 'text-xs text-neutral-500',
                } as CellText,
                {
                  //   type: "link",
                  //   href: `${metadata.permalink}`,
                  type: 'text',
                  value: metadata.title,
                  className:
                    'text-md font-medium text-black hover:no-underline no-underline line-clamp-2',
                  hoverCard: {
                    title: metadata.title,
                    description: metadata.selftext_html,
                    url: `${metadata.permalink}`,
                    footerItems: [],
                  },
                } as CellText,
                {
                  type: 'mixed',
                  className: 'flex flex-row items-center gap-2',
                  items: [
                    {
                      type: 'link',
                      href: `https://www.reddit.com/r/${metadata.subreddit}`,
                      text: `r/${metadata.subreddit}`,
                      className:
                        'text-xs text-neutral-500 hover:underline no-underline',
                    } as CellLink,
                    {
                      type: 'text',
                      value: '•',
                      className: 'text-xs text-neutral-500',
                    },
                    {
                      type: 'link',
                      href: `https://www.reddit.com/user/${metadata.author}`,
                      text: `u/${metadata.author}`,
                      className:
                        'text-xs text-neutral-500 hover:underline no-underline',
                    } as CellLink,
                    {
                      type: 'text',
                      value: '•',
                      className: 'text-xs text-neutral-500',
                    },
                    {
                      type: 'text',
                      value: prettySinceTime(
                        new Date(metadata.created_utc * 1000).toISOString(),
                      ),
                      className: 'text-xs text-neutral-500',
                    } as CellText,
                  ],
                },
              ],
            },
          },
          // Column 2: Score
          {
            className: 'flex-1',
            cell: {
              type: 'mixed',
              className: 'flex flex-col items-end',
              items: [
                {
                  type: 'text',
                  value: `${metadata.num_comments} comments`,
                  className: 'text-sm font-bold',
                } as CellText,
                {
                  type: 'text',
                  value: `(${Math.round(metadata.upvote_ratio * 100)}% upvoted)`,
                  className: 'text-xs text-neutral-500',
                } as CellText,
              ],
            },
          },
        ],
      } as DataTableRow;
    }),
  };
};
