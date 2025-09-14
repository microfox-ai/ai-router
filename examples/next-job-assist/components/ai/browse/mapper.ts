import { ToolUIPart } from 'ai';
import { BrowseMcp, BrowseOutput } from './types';

export const mapBrowseImageSearch = (data: any) => {
  let output: BrowseOutput = {
    image_sources: [],
  };
  if (data && Array.isArray(data)) {
    output.image_sources = data
      ?.filter((image: any) => image && image.src)
      .map((image: any) => {
        const originalSrc =
          image.responsiveImages && image.responsiveImages.length > 0
            ? image.responsiveImages?.[image.responsiveImages.length - 1]
            : undefined;
        const webSearchSource: BrowseOutput['image_sources'][number] = {
          title: image.alt,
          description: image.description,
          src: image.src,
          originalSrc: originalSrc?.url,
          imagePageUrl: image.imgPermalink,
          pageUrl: image.pagePermalink,
          srcHeight: originalSrc?.height ?? image.height,
          srcWidth: originalSrc?.width ?? image.width,
          set: image.responsiveImages?.map((img: any) => ({
            src: img.url,
            originalSrc: img.src,
            size: img.size,
            srcHeight: img.height,
            srcWidth: img.width,
          })),
          url: image.src,
        };
        return webSearchSource;
      });
  } else if (data && !Array.isArray(data)) {
    output.image_sources = Object.values(data).map((image: any) => {
      return {
        title: image.alt,
        description: image.description,
        src: image.src,
        originalSrc: image.src,
        imagePageUrl: image.imgPermalink,
        pageUrl: image.pagePermalink,
        srcHeight: image.height,
        srcWidth: image.width,
        set: [],
        url: image.src,
      };
    });
  }
  return output as BrowseOutput;
};

export const mapBrowseMcp = (
  output: any,
  toolName?: keyof BrowseMcp,
  part?: ToolUIPart,
) => {
  switch (toolName) {
    case 'extractImagesFromURL':
      if (output.contentType === 'application/json' && output.data) {
        return {
          extractImagesFromURL: mapBrowseImageSearch(output.data),
        };
      }
    default:
      return {};
  }
};
