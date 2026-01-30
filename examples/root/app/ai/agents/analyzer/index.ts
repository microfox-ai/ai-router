import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';

const aiRouter = new AiRouter();

/**
 * Analyzer Agent
 * Analyzes text content using pure logic - no external APIs required.
 * Performs sentiment analysis, topic extraction, and insight generation.
 */
export const analyzerAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Analyzing content...',
    });

    const { content, analysisType } = ctx.request.params;

    // Simulate analysis delay
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 700));

    // Perform analysis using pure logic
    const analysis = analyzeContent(content, analysisType);

    return {
      analysisType,
      ...analysis,
      analyzedAt: new Date().toISOString(),
    };
  })
  .actAsTool('/', {
    id: 'analyzer',
    name: 'Content Analyzer',
    description: 'Analyzes text content to extract insights, sentiment, and topics',
    inputSchema: z.object({
      content: z.string().describe('The text content to analyze'),
      analysisType: z.enum(['sentiment', 'topics', 'comprehensive']).describe('Type of analysis to perform'),
    }) as any,
    outputSchema: z.object({
      analysisType: z.string(),
      insights: z.array(z.string()),
      sentiment: z.object({
        label: z.enum(['positive', 'negative', 'neutral']),
        score: z.number(),
      }).optional(),
      topics: z.array(z.object({
        topic: z.string(),
        description: z.string(),
      })).optional(),
      summary: z.string(),
      analyzedAt: z.string(),
    }) as any,
    metadata: {
      icon: '🔍',
      title: 'Content Analyzer',
      hideUI: false,
    },
  });

/**
 * Analyze content using pure logic
 */
function analyzeContent(content: string, analysisType: string): {
  insights: string[];
  sentiment?: { label: 'positive' | 'negative' | 'neutral'; score: number };
  topics?: Array<{ topic: string; description: string }>;
  summary: string;
} {
  const result: {
    insights: string[];
    sentiment?: { label: 'positive' | 'negative' | 'neutral'; score: number };
    topics?: Array<{ topic: string; description: string }>;
    summary: string;
  } = {
    insights: [],
    summary: '',
  };

  // Always extract insights
  result.insights = extractInsights(content);

  // Extract sentiment if requested
  if (analysisType === 'sentiment' || analysisType === 'comprehensive') {
    result.sentiment = analyzeSentiment(content);
  }

  // Extract topics if requested
  if (analysisType === 'topics' || analysisType === 'comprehensive') {
    result.topics = extractTopics(content);
  }

  // Generate summary
  result.summary = generateSummary(content, result);

  return result;
}

/**
 * Extract key insights from content
 */
function extractInsights(content: string): string[] {
  const insights: string[] = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);

  // Extract insights based on sentence patterns
  const insightPatterns = [
    /(?:important|critical|essential|key|significant|notable|remarkable)/i,
    /(?:demonstrates?|reveals?|indicates?|suggests?|shows?)/i,
    /(?:impact|effect|influence|benefit|advantage|opportunity)/i,
  ];

  for (const sentence of sentences) {
    for (const pattern of insightPatterns) {
      if (pattern.test(sentence) && insights.length < 5) {
        const cleaned = sentence.trim().substring(0, 150);
        if (cleaned.length > 30 && !insights.includes(cleaned)) {
          insights.push(cleaned);
          break;
        }
      }
    }
  }

  // Fallback: extract first few substantial sentences
  if (insights.length === 0) {
    insights.push(...sentences.slice(0, 3).map(s => s.trim().substring(0, 150)));
  }

  return insights.slice(0, 5);
}

/**
 * Analyze sentiment using word lists
 */
function analyzeSentiment(content: string): { label: 'positive' | 'negative' | 'neutral'; score: number } {
  const positiveWords = [
    'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'brilliant',
    'success', 'benefit', 'advantage', 'opportunity', 'positive', 'improve', 'better',
    'effective', 'efficient', 'valuable', 'important', 'essential', 'critical',
    'promising', 'transformative', 'innovative', 'breakthrough', 'achievement',
  ];

  const negativeWords = [
    'bad', 'poor', 'terrible', 'awful', 'horrible', 'disappointing', 'failing',
    'problem', 'issue', 'challenge', 'difficulty', 'negative', 'worse', 'decline',
    'ineffective', 'inefficient', 'waste', 'risk', 'threat', 'danger', 'concern',
    'limitation', 'obstacle', 'barrier', 'failure', 'crisis',
  ];

  const words = content.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (positiveWords.includes(cleanWord)) positiveCount++;
    if (negativeWords.includes(cleanWord)) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) {
    return { label: 'neutral', score: 0.5 };
  }

  const positiveRatio = positiveCount / total;
  const negativeRatio = negativeCount / total;

  if (positiveRatio > negativeRatio + 0.1) {
    return { label: 'positive', score: Math.min(0.5 + positiveRatio * 0.5, 0.95) };
  } else if (negativeRatio > positiveRatio + 0.1) {
    return { label: 'negative', score: Math.min(0.5 + negativeRatio * 0.5, 0.95) };
  } else {
    return { label: 'neutral', score: 0.5 };
  }
}

/**
 * Extract topics using keyword frequency and patterns
 */
function extractTopics(content: string): Array<{ topic: string; description: string }> {
  // Common topic keywords
  const topicKeywords: Record<string, string[]> = {
    'Technology': ['technology', 'digital', 'software', 'system', 'platform', 'application', 'innovation'],
    'Business': ['business', 'company', 'organization', 'enterprise', 'market', 'industry', 'strategy'],
    'Science': ['research', 'study', 'analysis', 'data', 'evidence', 'theory', 'hypothesis'],
    'Education': ['learning', 'education', 'teaching', 'knowledge', 'skill', 'training', 'development'],
    'Health': ['health', 'medical', 'wellness', 'treatment', 'care', 'therapy', 'medicine'],
    'Environment': ['environment', 'climate', 'sustainability', 'green', 'energy', 'conservation', 'ecology'],
    'Society': ['society', 'social', 'community', 'culture', 'people', 'public', 'human'],
    'Economics': ['economic', 'financial', 'economy', 'money', 'investment', 'revenue', 'cost'],
  };

  const contentLower = content.toLowerCase();
  const topicScores: Record<string, number> = {};

  // Score topics based on keyword frequency
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\w*\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    if (score > 0) {
      topicScores[topic] = score;
    }
  }

  // Extract top topics
  const sortedTopics = Object.entries(topicScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Generate topic descriptions
  const topics = sortedTopics.map(([topic, score]) => {
    const sentences = content.split(/[.!?]+/).filter(s => 
      s.toLowerCase().includes(topic.toLowerCase()) && s.trim().length > 30
    );
    
    const description = sentences.length > 0
      ? sentences[0].trim().substring(0, 120) + '...'
      : `Content discusses ${topic.toLowerCase()} with ${score} relevant mentions.`;

    return { topic, description };
  });

  // Fallback: extract noun phrases if no topics found
  if (topics.length === 0) {
    const words = content.split(/\s+/).filter(w => w.length > 5);
    const uniqueWords = [...new Set(words)].slice(0, 5);
    return uniqueWords.map(word => ({
      topic: word.charAt(0).toUpperCase() + word.slice(1),
      description: `Key concept mentioned in the content.`,
    }));
  }

  return topics;
}

/**
 * Generate summary
 */
function generateSummary(content: string, analysis: any): string {
  const wordCount = content.split(/\s+/).length;
  const sentenceCount = content.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  
  let summary = `The content contains ${wordCount} words across ${sentenceCount} sentences. `;

  if (analysis.sentiment) {
    summary += `The overall sentiment is ${analysis.sentiment.label} (confidence: ${(analysis.sentiment.score * 100).toFixed(0)}%). `;
  }

  if (analysis.topics && analysis.topics.length > 0) {
    summary += `Main topics include: ${analysis.topics.slice(0, 3).map((t: any) => t.topic).join(', ')}. `;
  }

  if (analysis.insights && analysis.insights.length > 0) {
    summary += `Key insights highlight ${analysis.insights.length} important points.`;
  }

  return summary;
}
