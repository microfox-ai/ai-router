'use client';

import { braveResearchMap } from "./braveResearch";
import { summariseComponentMap } from "./summarize";


export const aiComponentMap = {
    tools: {
        ...braveResearchMap,
        ...summariseComponentMap,
    },
};