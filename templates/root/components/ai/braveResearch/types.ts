import { UiCommonTypes } from '@microfox/types';

export type WebSearchSource = {
  timestamp?: string;
  description?: string;
  displayDate?: string;
  title?: string;
  subType?: string; // article, generic
  icon?: Partial<UiCommonTypes['ImageSet']>;
  thumbnail?: Partial<UiCommonTypes['ImageSet']>;
  meta_media?: Partial<UiCommonTypes['VideoSet']>;
  meta_url?: {
    favicon?: string;
    hostname?: string;
    domain?: string; // netloc
    breadcrumb?: string;
  };
  url: string;
  media_type?: 'video' | 'image' | 'audio';
};

export type BraveWebSearchOutput = {
  video_sources: WebSearchSource[];
  web_sources: WebSearchSource[];
  image_sources: WebSearchSource[];
};

export type BraveMcp = {
  webSearch: BraveWebSearchOutput;
  imageSearch: BraveWebSearchOutput;
};
