import { ToolUIPart } from 'ai';
import { BraveWebSearchOutput } from './types';

export const mapBraveWebSearch = (data: {
  searchType: 'web' | 'image' | 'video' | 'news';
  response: any;
}) => {
  let output: BraveWebSearchOutput = {
    video_sources: [],
    web_sources: [],
    image_sources: [],
  };

  if (data.searchType === 'web') {
    if (data.response.videos) {
      output.video_sources = data.response.videos.results
        ?.filter((video: any) => video)
        .map((video: any) => ({
          timestamp: video.page_age,
          description: video.description,
          displayDate: video.age,
          title: video.title,
          thumbnail: {
            src: video?.thumbnail?.src,
            originalSrc: video?.thumbnail?.original,
            srcHeight: video?.thumbnail?.height,
            srcWidth: video?.thumbnail?.width,
          },
          meta_media: {
            src: video.url,
            creator: video.video?.creator,
            duration: video.video?.duration,
            views: video.video?.views,
          },
          meta_url: {
            favicon: video.meta_url?.favicon,
            hostname: video.meta_url?.hostname,
            domain: video.meta_url?.domain,
            breadcrumb: video.meta_url?.path,
          },
          url: video.url,
          media_type: 'video',
        }));
    }
    if (data.response.web) {
      output.web_sources = data.response.web.results
        ?.filter((web: any) => web)
        .map((web: any) => ({
          timestamp: web.page_age,
          description: web.description,
          displayDate: web.age,
          title: web.title,
          thumbnail:
            !web.thumbnail?.logo && web.thumbnail
              ? {
                  src: web.thumbnail?.src,
                  originalSrc: web.thumbnail?.original,
                  srcHeight: web.thumbnail?.height,
                  srcWidth: web.thumbnail?.width,
                  imagePageUrl: web.url,
                  pageUrl: web.url,
                }
              : undefined,
          icon: web.thumbnail?.logo
            ? {
                src: web.thumbnail.logo.src,
                originalSrc: web.thumbnail.logo.original,
              }
            : undefined,
          subType: web.subType,
          meta_url: {
            favicon: web.meta_url?.favicon,
            hostname: web.meta_url?.hostname,
            domain: web.meta_url?.domain,
            breadcrumb: web.meta_url?.path,
          },
          url: web.url,
        }));
    }
    return output;
  } else if (data.searchType === 'image') {
    output.image_sources = mapBraveImageSearch(data.response);
    return output;
  }
  return output;
};

export const mapBraveImageSearch = (data: any) => {
  if (data.results) {
    return data.results
      ?.filter((image: any) => image)
      .map((image: any) => ({
        timestamp: image.page_age,
        description: image.description,
        displayDate: image.age,
        title: image.title,
        thumbnail: {
          src: image.thumbnail?.src,
          originalSrc: image.thumbnail?.original,
          srcHeight: image.thumbnail?.height,
          srcWidth: image.thumbnail?.width,
        },
        meta_url: {
          favicon: image.meta_url?.favicon,
          hostname: image.meta_url?.hostname,
          domain: image.meta_url?.domain,
          breadcrumb: image.meta_url?.path,
        },
        media_type: 'image',
        url: image.url,
      }));
  }
  return [];
};
