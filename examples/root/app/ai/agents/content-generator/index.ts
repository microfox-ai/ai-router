import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';

const aiRouter = new AiRouter();

/**
 * Content Generator Agent
 * Generates structured content based on a topic and style using pure logic.
 * No external APIs required - uses templates and algorithmic generation.
 */
export const contentGeneratorAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Generating content...',
    });

    const { topic, style, length } = ctx.request.params;

    // Simulate generation delay for realism
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

    // Generate content using templates and logic
    const content = generateContent(topic, style, length);

    return {
      topic,
      style,
      length,
      content,
      wordCount: content.split(/\s+/).length,
      generatedAt: new Date().toISOString(),
    };
  })
  .actAsTool('/', {
    id: 'contentGenerator',
    name: 'Content Generator',
    description: 'Generates written content on any topic in various styles and lengths',
    inputSchema: z.object({
      topic: z.string().describe('The topic to write about'),
      style: z.enum(['informative', 'persuasive', 'narrative', 'analytical']).describe('The writing style'),
      length: z.enum(['short', 'medium', 'long']).describe('The desired length of the content'),
    }) as any,
    outputSchema: z.object({
      topic: z.string(),
      style: z.string(),
      length: z.string(),
      content: z.string(),
      wordCount: z.number(),
      generatedAt: z.string(),
    }) as any,
    metadata: {
      icon: '✍️',
      title: 'Content Generator',
      hideUI: false,
    },
  });

/**
 * Generate content using pure logic and templates
 */
function generateContent(topic: string, style: string, length: string): string {
  const paragraphCount = length === 'short' ? 3 : length === 'medium' ? 5 : 8;
  const sentencesPerParagraph = length === 'short' ? 3 : length === 'medium' ? 4 : 5;

  const sections: string[] = [];

  // Introduction
  sections.push(generateIntroduction(topic, style));

  // Body paragraphs
  for (let i = 0; i < paragraphCount - 2; i++) {
    sections.push(generateBodyParagraph(topic, style, i, paragraphCount - 2, sentencesPerParagraph));
  }

  // Conclusion
  sections.push(generateConclusion(topic, style));

  return sections.join('\n\n');
}

function generateIntroduction(topic: string, style: string): string {
  const hooks = {
    informative: [
      `In today's rapidly evolving landscape, ${topic} represents a critical area of focus.`,
      `Understanding ${topic} is essential for navigating the complexities of modern challenges.`,
      `${topic} has emerged as a key consideration in contemporary discourse.`,
    ],
    persuasive: [
      `Imagine a world where ${topic} transforms how we approach fundamental challenges.`,
      `The potential impact of ${topic} cannot be overstated—it's a game-changer.`,
      `When it comes to ${topic}, the evidence speaks for itself.`,
    ],
    narrative: [
      `Let me tell you a story about ${topic}—one that reveals unexpected insights.`,
      `Picture this: ${topic} unfolds in ways that challenge our assumptions.`,
      `The journey of understanding ${topic} begins with a simple observation.`,
    ],
    analytical: [
      `A systematic examination of ${topic} reveals multiple interconnected factors.`,
      `Breaking down ${topic} into its core components provides valuable insights.`,
      `The analytical framework for ${topic} encompasses several key dimensions.`,
    ],
  };

  const styleHooks = hooks[style as keyof typeof hooks] || hooks.informative;
  const hook = styleHooks[Math.floor(Math.random() * styleHooks.length)];

  const transitions = [
    'This article explores the key aspects and implications.',
    'We will examine the fundamental principles and applications.',
    'Let us delve into the core concepts and their significance.',
  ];

  return `${hook} ${transitions[Math.floor(Math.random() * transitions.length)]}`;
}

function generateBodyParagraph(topic: string, style: string, index: number, total: number, sentences: number): string {
  const aspects = [
    'fundamental principles',
    'practical applications',
    'key challenges',
    'emerging trends',
    'strategic implications',
    'technical considerations',
    'social impact',
    'economic factors',
  ];

  const aspect = aspects[index % aspects.length];
  const sentencesList: string[] = [];

  for (let i = 0; i < sentences; i++) {
    if (i === 0) {
      // Topic sentence
      sentencesList.push(generateTopicSentence(topic, aspect, style));
    } else if (i === sentences - 1) {
      // Concluding sentence for paragraph
      sentencesList.push(generateConcludingSentence(aspect, style));
    } else {
      // Supporting sentences
      sentencesList.push(generateSupportingSentence(aspect, style));
    }
  }

  return sentencesList.join(' ');
}

function generateTopicSentence(topic: string, aspect: string, style: string): string {
  const templates = {
    informative: [
      `One of the most important ${aspect} of ${topic} involves understanding its core mechanisms.`,
      `The ${aspect} related to ${topic} demonstrate significant complexity and nuance.`,
      `Examining the ${aspect} of ${topic} reveals several critical insights.`,
    ],
    persuasive: [
      `The ${aspect} of ${topic} make a compelling case for immediate attention.`,
      `When we consider the ${aspect} of ${topic}, the benefits become undeniable.`,
      `The ${aspect} surrounding ${topic} point to transformative potential.`,
    ],
    narrative: [
      `As we explore the ${aspect} of ${topic}, an interesting pattern emerges.`,
      `The story of ${topic}'s ${aspect} unfolds with surprising twists.`,
      `In examining the ${aspect} of ${topic}, we discover unexpected connections.`,
    ],
    analytical: [
      `A detailed analysis of ${topic}'s ${aspect} reveals three primary factors.`,
      `The ${aspect} of ${topic} can be categorized into distinct analytical frameworks.`,
      `Systematic evaluation of ${topic}'s ${aspect} yields quantifiable insights.`,
    ],
  };

  const styleTemplates = templates[style as keyof typeof templates] || templates.informative;
  return styleTemplates[Math.floor(Math.random() * styleTemplates.length)];
}

function generateSupportingSentence(aspect: string, style: string): string {
  const connectors = ['Furthermore,', 'Additionally,', 'Moreover,', 'In particular,', 'Specifically,'];
  const connector = connectors[Math.floor(Math.random() * connectors.length)];

  const details = [
    `this demonstrates the interconnected nature of various components.`,
    `research indicates multiple pathways for implementation and optimization.`,
    `practical examples illustrate the real-world applications and benefits.`,
    `the data suggests significant potential for improvement and innovation.`,
    `experts agree that this represents a fundamental shift in approach.`,
  ];

  return `${connector} ${details[Math.floor(Math.random() * details.length)]}`;
}

function generateConcludingSentence(aspect: string, style: string): string {
  const transitions = {
    informative: [
      `This understanding of ${aspect} provides a solid foundation for further exploration.`,
      `These insights into ${aspect} highlight the importance of continued research.`,
    ],
    persuasive: [
      `The evidence surrounding ${aspect} makes a strong case for action.`,
      `Clearly, the ${aspect} demand our immediate attention and commitment.`,
    ],
    narrative: [
      `The ${aspect} tell a story of innovation and possibility.`,
      `As we've seen, the ${aspect} reveal unexpected opportunities.`,
    ],
    analytical: [
      `The analysis of ${aspect} points to measurable outcomes and trends.`,
      `Quantitative assessment of ${aspect} confirms the initial hypotheses.`,
    ],
  };

  const styleTransitions = transitions[style as keyof typeof transitions] || transitions.informative;
  return styleTransitions[Math.floor(Math.random() * styleTransitions.length)];
}

function generateConclusion(topic: string, style: string): string {
  const conclusions = {
    informative: [
      `In conclusion, ${topic} represents a multifaceted domain with far-reaching implications.`,
      `To summarize, ${topic} encompasses a range of important considerations that warrant careful examination.`,
    ],
    persuasive: [
      `The evidence is clear: ${topic} offers transformative opportunities that we cannot afford to ignore.`,
      `In light of these findings, ${topic} emerges as a critical priority for forward-thinking individuals and organizations.`,
    ],
    narrative: [
      `As our exploration of ${topic} comes to a close, we're left with a deeper appreciation for its complexity and potential.`,
      `The story of ${topic} continues to unfold, promising new chapters of discovery and innovation.`,
    ],
    analytical: [
      `The analytical framework for ${topic} reveals systematic patterns and quantifiable relationships.`,
      `Through rigorous examination, ${topic} demonstrates measurable impact across multiple dimensions.`,
    ],
  };

  const styleConclusions = conclusions[style as keyof typeof conclusions] || conclusions.informative;
  const conclusion = styleConclusions[Math.floor(Math.random() * styleConclusions.length)];

  const callsToAction = [
    'The insights gained from this exploration provide valuable guidance for future endeavors.',
    'Moving forward, continued engagement with these concepts will yield significant benefits.',
    'This foundation sets the stage for deeper understanding and practical application.',
  ];

  return `${conclusion} ${callsToAction[Math.floor(Math.random() * callsToAction.length)]}`;
}
