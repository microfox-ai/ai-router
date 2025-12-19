import { UiCommonTypes } from "@microfox/types";

export type BrowseOutput = {
  image_sources: UiCommonTypes["ImageSet"][];
};

export type BrowseMcp = {
  extractImagesFromURL: BrowseOutput;
};
