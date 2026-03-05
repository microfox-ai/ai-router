// "use client";

// import { uiHitlMap } from "../mappers/uiHitl";
// import { MediaGrid } from "../../studio/ui/media";

// export const BrowseMediaGrid = ({
//     output,
//     toolName,
// }: {
//     //output: uiHitlMap["puppeteer-sls"]["extractImagesFromURL"] | undefined;
//     toolName?: string;
// }) => {
//     if (!output || !toolName) {
//         return null;
//     }

//     let data = toolName in output ? output[toolName as keyof typeof output] : undefined;
//     if (!data && "image_sources" in output) {
//         data = output.image_sources;
//     }

//     if (data && data.length > 0) {
//         const images = data;
//         return <MediaGrid images={images} />;
//     }

//     return null;
// }