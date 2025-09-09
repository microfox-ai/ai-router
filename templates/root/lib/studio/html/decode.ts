export const decodeHtmlEntities = (text: string): string => {
  if (typeof window === 'undefined') {
    // Basic fallback for server-side rendering
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};
